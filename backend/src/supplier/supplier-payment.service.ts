import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase-order.entity';
import { SupplierPayment } from './supplier-payment.entity';
import { CreateSupplierPaymentDto } from './dto/supplier.dto';
import { computePaymentStatus } from '../invoice/payment-status.util';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

const ACCOUNTS_PAYABLE_CODE = '2000';

// Mirrors InvoicePaymentService exactly (the sales-side equivalent) —
// same round3/todayStr helpers, same tolerance, same optional-bank-sync
// + auto-posting pattern, just the other side of the ledger: paying a
// RECEIVED purchase order down instead of collecting on an invoice.
@Injectable()
export class SupplierPaymentService {
  constructor(
    @InjectRepository(SupplierPayment)
    private repo: Repository<SupplierPayment>,
    @InjectRepository(PurchaseOrder)
    private orderRepo: Repository<PurchaseOrder>,
    @InjectDataSource()
    private dataSource: DataSource,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // Auto-posts (or removes) Dr 2000 Accounts Payable / Cr {this
  // payment's linked bank/cash account} — only when the payment has a
  // bankAccountId (a record-only payment isn't auto-posted).
  private async postJournalEntry(payment: SupplierPayment, actor: ActorRef) {
    try {
      if (!payment.bankAccountId) {
        await this.journalPosting.removeForSource('supplier_payment', payment.id);
        return;
      }
      const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(payment.bankAccountId);
      const po = await this.orderRepo.findOne({ where: { id: payment.purchaseOrderId } });
      const ref = po?.poNumber || payment.purchaseOrderId;
      await this.journalPosting.postForSource(
        'supplier_payment',
        payment.id,
        payment.paymentDate,
        `Payment to supplier — ${ref}`,
        [
          { accountId: apAccountId, debit: Number(payment.amount), description: ref },
          { accountId: bankJournalAccountId, credit: Number(payment.amount), description: 'Payment to supplier' },
        ],
        actor,
      );
    } catch (err) {
      console.error(`Auto-posting failed for supplier_payment ${payment.id}:`, err);
    }
  }

  findByOrder(purchaseOrderId: string) {
    return this.repo.find({ where: { purchaseOrderId }, order: { paymentDate: 'ASC', createdAt: 'ASC' } });
  }

  // Records one installment against a RECEIVED purchase order's
  // Accounts Payable balance and immediately updates the order's
  // paidAmount/paymentStatus, so the Suppliers list and Dashboard's
  // Payable Bills stay correct without re-summing this table.
  async create(purchaseOrderId: string, dto: CreateSupplierPaymentDto, actor: ActorRef = {}) {
    const order = await this.orderRepo.findOne({ where: { id: purchaseOrderId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.RECEIVED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Nothing has been received on this order yet, so nothing is owed.');
    }

    const amount = this.round3(Number(dto.amount));
    const alreadyPaid = Number(order.paidAmount || 0);
    // what is owed = value of the goods actually received
    const total = Number(order.receivedTotal || 0);
    // 0.001 tolerance matches the 3-decimal OMR precision used everywhere
    // else, so settling the exact remaining balance never gets rejected
    // over a floating-point sliver.
    if (alreadyPaid + amount > total + 0.001) {
      const remaining = this.round3(Math.max(0, total - alreadyPaid));
      throw new BadRequestException(
        `This payment (${amount.toFixed(3)} OMR) would exceed what is owed for the goods received (${remaining.toFixed(3)} OMR). Pay ahead with a vendor prepayment instead.`,
      );
    }

    const payment = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | undefined;
      if (dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < amount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} for this payment.`);
        }
        account.currentBalance = Number(account.currentBalance) - amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount,
            date: dto.paymentDate || this.todayStr(),
            note: `Payment to supplier — ${order.poNumber}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      const row = manager.create(SupplierPayment, {
        purchaseOrderId,
        supplierId: order.supplierId,
        amount,
        paymentType: dto.paymentType,
        paymentDate: dto.paymentDate || this.todayStr(),
        note: dto.note,
        bankAccountId: dto.bankAccountId,
        bankTransactionId,
      });
      return manager.save(row);
    });

    order.paidAmount = this.round3(alreadyPaid + amount);
    order.paymentStatus = computePaymentStatus(order.paidAmount, total);
    await this.orderRepo.save(order);

    await this.postJournalEntry(payment, actor);
    return payment;
  }

  // Undoes a mistaken entry and recomputes paidAmount/paymentStatus from
  // what's left, rather than just subtracting (safer if the ledger and
  // order ever drift). Reverses any bank withdrawal + auto-posted entry.
  async remove(purchaseOrderId: string, paymentId: string) {
    const payment = await this.repo.findOne({ where: { id: paymentId, purchaseOrderId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.creditSource) {
      throw new BadRequestException('This row is a credit from a purchase return, vendor credit or prepayment - it is removed together with that record, not here.');
    }

    if (payment.bankAccountId && payment.bankTransactionId) {
      try {
        const account = await this.dataSource.manager.findOne(BankAccount, { where: { id: payment.bankAccountId } });
        if (account) {
          account.currentBalance = Number(account.currentBalance) + Number(payment.amount);
          await this.dataSource.manager.save(account);
        }
        await this.dataSource.manager.delete(BankTransaction, payment.bankTransactionId);
      } catch (err) {
        console.error(`Reversing bank withdrawal failed for supplier_payment ${payment.id}:`, err);
      }
    }
    try {
      await this.journalPosting.removeForSource('supplier_payment', payment.id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for supplier_payment ${payment.id}:`, err);
    }

    await this.repo.remove(payment);

    const order = await this.orderRepo.findOne({ where: { id: purchaseOrderId } });
    if (order) {
      const remaining = await this.repo.find({ where: { purchaseOrderId } });
      const paidAmount = this.round3(remaining.reduce((sum, p) => sum + Number(p.amount), 0));
      order.paidAmount = paidAmount;
      order.paymentStatus = computePaymentStatus(paidAmount, Number(order.receivedTotal || 0));
      await this.orderRepo.save(order);
    }
    return { ok: true };
  }

  // Undo of a deleted supplier payment: same id and data, the bank
  // withdrawal and journal entry are put back and the order's paid amount
  // recomputed. Refused if the order is gone/not received, the payment no
  // longer fits its balance, or the account can't cover it.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const order = await this.orderRepo.findOne({ where: { id: String(data.purchaseOrderId) } });
    if (!order) throw new BadRequestException('The purchase order of this payment no longer exists.');
    if (order.status !== PurchaseOrderStatus.RECEIVED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Nothing is owed on this purchase order any more.');
    }
    const amount = this.round3(Number(data.amount));
    const paid = Number(order.paidAmount || 0);
    if (paid + amount > Number(order.receivedTotal || 0) + 0.001) {
      throw new BadRequestException(`Putting this payment back (${amount.toFixed(3)} OMR) would exceed what is still owed on this order.`);
    }
    const payment = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | null = null;
      if (data.bankAccountId) {
        bankTransactionId = await applyBankMovement(manager, {
          accountId: String(data.bankAccountId),
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date: String(data.paymentDate),
          note: `Payment to supplier — ${order.poNumber}`,
        });
      }
      await manager.insert(SupplierPayment, { ...rowForInsert(data), amount, bankTransactionId } as any);
      return manager.findOneOrFail(SupplierPayment, { where: { id: String(data.id) } });
    });
    const all = await this.repo.find({ where: { purchaseOrderId: order.id } });
    order.paidAmount = this.round3(all.reduce((sum, p) => sum + Number(p.amount), 0));
    order.paymentStatus = computePaymentStatus(order.paidAmount, Number(order.receivedTotal || 0));
    await this.orderRepo.save(order);
    await this.postJournalEntry(payment, actor);
    return payment;
  }

  // A credit that lowers what is owed on an order without money moving:
  // debit note (approved purchase return), vendor credit or prepayment
  // applied to it. The journal entry belongs to that record.
  async addCreditRow(
    manager: import('typeorm').EntityManager,
    opts: { purchaseOrderId: string; amount: number; date: string; note: string; source: 'debit_note' | 'vendor_credit' | 'vendor_prepayment'; sourceId: string; supplierId?: string },
  ) {
    const order = await manager.findOne(PurchaseOrder, { where: { id: opts.purchaseOrderId }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (opts.supplierId && order.supplierId !== opts.supplierId) {
      throw new BadRequestException(`${order.poNumber} belongs to a different supplier.`);
    }
    if (order.status !== PurchaseOrderStatus.RECEIVED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException(`${order.poNumber}: nothing has been received yet, so nothing is owed to apply this to.`);
    }
    const amount = this.round3(opts.amount);
    const due = this.round3(Number(order.receivedTotal || 0) - Number(order.paidAmount || 0));
    if (amount > due + 0.001) {
      throw new BadRequestException(`${order.poNumber}: only ${Math.max(0, due).toFixed(3)} OMR is still owed - apply at most that much.`);
    }
    await manager.save(
      manager.create(SupplierPayment, {
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        amount,
        paymentDate: opts.date,
        note: opts.note,
        creditSource: opts.source,
        creditSourceId: opts.sourceId,
      }),
    );
    order.paidAmount = this.round3(Number(order.paidAmount || 0) + amount);
    order.paymentStatus = computePaymentStatus(order.paidAmount, Number(order.receivedTotal || 0));
    await manager.save(order);
  }

  // Recomputes paidAmount/paymentStatus from the rows (after a credit row
  // is removed with its source record).
  async recompute(manager: import('typeorm').EntityManager, purchaseOrderId: string) {
    const order = await manager.findOne(PurchaseOrder, { where: { id: purchaseOrderId } });
    if (!order) return;
    const rows = await manager.find(SupplierPayment, { where: { purchaseOrderId } });
    order.paidAmount = this.round3(rows.reduce((sum, p) => sum + Number(p.amount), 0));
    order.paymentStatus = computePaymentStatus(order.paidAmount, Number(order.receivedTotal || 0));
    await manager.save(order);
  }
}
