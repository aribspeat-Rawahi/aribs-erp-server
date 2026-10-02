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
      await this.journalPosting.postForSource(
        'supplier_payment',
        payment.id,
        payment.paymentDate,
        `Payment to supplier — PO ${payment.purchaseOrderId}`,
        [
          { accountId: apAccountId, debit: Number(payment.amount), description: `PO ${payment.purchaseOrderId}` },
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
    if (order.status !== PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Only a RECEIVED purchase order has an Accounts Payable balance to pay.');
    }

    const amount = this.round3(Number(dto.amount));
    const alreadyPaid = Number(order.paidAmount || 0);
    const total = Number(order.total || 0);
    // 0.001 tolerance matches the 3-decimal OMR precision used everywhere
    // else, so settling the exact remaining balance never gets rejected
    // over a floating-point sliver.
    if (alreadyPaid + amount > total + 0.001) {
      const remaining = this.round3(Math.max(0, total - alreadyPaid));
      throw new BadRequestException(
        `This payment (${amount.toFixed(3)} OMR) would exceed the remaining balance (${remaining.toFixed(3)} OMR). Reduce the amount, or check the order total.`,
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
            note: `Payment to supplier — PO ${order.id}`,
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
      order.paymentStatus = computePaymentStatus(paidAmount, Number(order.total || 0));
      await this.orderRepo.save(order);
    }
    return { ok: true };
  }
}
