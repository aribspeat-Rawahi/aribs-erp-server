import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Invoice } from './invoice.entity';
import { InvoicePayment } from './invoice-payment.entity';
import { CreateInvoicePaymentDto } from './dto/invoice.dto';
import { computePaymentStatus } from './payment-status.util';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

const ACCOUNTS_RECEIVABLE_CODE = '1100';

@Injectable()
export class InvoicePaymentService {
  constructor(
    @InjectRepository(InvoicePayment)
    private repo: Repository<InvoicePayment>,
    // Plain repo injection (not InvoiceService) so there's no circular
    // dependency — same pattern used for Customer's bank-account/document
    // cleanup.
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectDataSource()
    private dataSource: DataSource,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  // Auto-posts (or removes) Dr {this payment's linked bank/cash account}
  // / Cr 1100 Accounts Receivable — only when the payment has a
  // bankAccountId (a record-only payment isn't auto-posted). Best-effort,
  // separate from the balance-moving transaction.
  private async postJournalEntry(payment: InvoicePayment, invoiceNumber: string, actor: ActorRef, rethrow = false) {
    try {
      if (!payment.bankAccountId) {
        await this.journalPosting.removeForSource('invoice_payment', payment.id);
        return;
      }
      const arAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_RECEIVABLE_CODE);
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(payment.bankAccountId);
      await this.journalPosting.postForSource(
        'invoice_payment',
        payment.id,
        payment.paymentDate,
        `Payment received — invoice ${invoiceNumber}`,
        [
          { accountId: bankJournalAccountId, debit: Number(payment.amount), description: 'Payment received' },
          { accountId: arAccountId, credit: Number(payment.amount), description: `Invoice ${invoiceNumber}` },
        ],
        actor,
        invoiceNumber,
      );
    } catch (err) {
      if (rethrow) throw err;
      console.error(`Auto-posting failed for invoice_payment ${payment.id}:`, err);
    }
  }

  // Books Health Check "Re-post": rebuilds this payment's journal entry.
  async repostJournal(id: string, actor: ActorRef = {}) {
    const payment = await this.repo.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.salesReturnId) throw new BadRequestException('This is a credit note - it is posted with its sales return.');
    const invoice = await this.invoiceRepo.findOne({ where: { id: payment.invoiceId } });
    const invoiceNumber = invoice?.invoiceNumber || payment.invoiceId;
    await this.postJournalEntry(payment, invoiceNumber, actor, true);
    return { reposted: true, number: invoiceNumber };
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  findByInvoice(invoiceId: string) {
    return this.repo.find({ where: { invoiceId }, order: { paymentDate: 'ASC', createdAt: 'ASC' } });
  }

  // Used by InvoiceService.generateCustomerStatement() — every payment
  // row against a set of that customer's invoices, in one query.
  async findByInvoiceIds(invoiceIds: string[]) {
    if (invoiceIds.length === 0) return [];
    return this.repo
      .createQueryBuilder('payment')
      .where('payment.invoiceId IN (:...invoiceIds)', { invoiceIds })
      .orderBy('payment.paymentDate', 'ASC')
      .addOrderBy('payment.createdAt', 'ASC')
      .getMany();
  }

  // Total payments recorded (any invoice) within a date range — the
  // Dashboard's "Total Collected" figure on the Invoice card.
  async getTotalInRange(startDate: string, endDate: string) {
    // credit notes from sales returns are not money collected
    const payments = await this.repo
      .createQueryBuilder('payment')
      .where('payment.paymentDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('payment.salesReturnId IS NULL')
      .getMany();
    return this.round3(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  }

  // Records one installment and immediately updates the invoice's
  // paidAmount/paymentStatus, so every other screen (Invoices list,
  // future Aging Report) stays correct without re-summing this table.
  // If dto.bankAccountId is set, also records a real deposit on that
  // account (row-locked, same pattern as everywhere else money moves)
  // and auto-posts the Journal Entry.
  async create(invoiceId: string, dto: CreateInvoicePaymentDto, actor: ActorRef = {}) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.journalPosting.assertDateOpen(dto.paymentDate || this.todayStr(), 'This payment');

    const amount = this.round3(Number(dto.amount));
    const alreadyPaid = Number(invoice.paidAmount || 0);
    const total = Number(invoice.total);
    // 0.001 tolerance matches the 3-decimal OMR precision used everywhere
    // else, so settling the exact remaining balance never gets rejected
    // over a floating-point sliver.
    if (alreadyPaid + amount > total + 0.001) {
      const remaining = this.round3(Math.max(0, total - alreadyPaid));
      throw new BadRequestException(
        `This payment (${amount.toFixed(3)} OMR) would exceed the remaining balance (${remaining.toFixed(3)} OMR). Reduce the amount, or check the invoice total.`,
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
        account.currentBalance = Number(account.currentBalance) + amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.DEPOSIT,
            amount,
            date: dto.paymentDate || this.todayStr(),
            note: `Payment received — invoice ${invoice.invoiceNumber}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      const row = manager.create(InvoicePayment, {
        invoiceId,
        amount,
        paymentType: dto.paymentType,
        paymentDate: dto.paymentDate || this.todayStr(),
        note: dto.note,
        bankAccountId: dto.bankAccountId,
        bankTransactionId,
      });
      return manager.save(row);
    });

    invoice.paidAmount = this.round3(alreadyPaid + amount);
    invoice.paymentStatus = computePaymentStatus(invoice.paidAmount, total);
    await this.invoiceRepo.save(invoice);

    await this.postJournalEntry(payment, invoice.invoiceNumber, actor);
    return payment;
  }

  // Undoes a mistaken entry (wrong amount, wrong invoice, ...) and
  // recomputes paidAmount/paymentStatus from what's left, rather than
  // just subtracting (safer if the ledger and invoice ever drift).
  // Reverses any bank deposit + auto-posted entry the payment had.
  async remove(invoiceId: string, paymentId: string) {
    const payment = await this.repo.findOne({ where: { id: paymentId, invoiceId } });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.journalPosting.assertDateOpen(payment.paymentDate, 'This payment');
    if (payment.salesReturnId) {
      throw new BadRequestException('This is the credit note of an approved sales return and cannot be deleted.');
    }

    if (payment.bankAccountId && payment.bankTransactionId) {
      try {
        const account = await this.dataSource.manager.findOne(BankAccount, { where: { id: payment.bankAccountId } });
        if (account) {
          account.currentBalance = Number(account.currentBalance) - Number(payment.amount);
          await this.dataSource.manager.save(account);
        }
        await this.dataSource.manager.delete(BankTransaction, payment.bankTransactionId);
      } catch (err) {
        console.error(`Reversing bank deposit failed for invoice_payment ${payment.id}:`, err);
      }
    }
    try {
      await this.journalPosting.removeForSource('invoice_payment', payment.id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for invoice_payment ${payment.id}:`, err);
    }

    await this.repo.remove(payment);

    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (invoice) {
      const remaining = await this.repo.find({ where: { invoiceId } });
      const paidAmount = this.round3(remaining.reduce((sum, p) => sum + Number(p.amount), 0));
      invoice.paidAmount = paidAmount;
      invoice.paymentStatus = computePaymentStatus(paidAmount, Number(invoice.total));
      await this.invoiceRepo.save(invoice);
    }
    return { ok: true };
  }

  // Called by InvoiceService.remove() to clean up an invoice's payment
  // rows when the invoice itself is deleted (no TypeORM cascade — plain
  // FK column, not a relation). Reverses each payment's bank deposit and
  // auto-posted entry the same way remove() does, so deleting an invoice
  // never leaves a stray balance or journal entry behind.
  async removeAllForInvoice(invoiceId: string) {
    const payments = await this.repo.find({ where: { invoiceId } });
    for (const payment of payments) {
      if (payment.bankAccountId && payment.bankTransactionId) {
        try {
          const account = await this.dataSource.manager.findOne(BankAccount, { where: { id: payment.bankAccountId } });
          if (account) {
            account.currentBalance = Number(account.currentBalance) - Number(payment.amount);
            await this.dataSource.manager.save(account);
          }
          await this.dataSource.manager.delete(BankTransaction, payment.bankTransactionId);
        } catch (err) {
          console.error(`Reversing bank deposit failed for invoice_payment ${payment.id}:`, err);
        }
      }
      try {
        await this.journalPosting.removeForSource('invoice_payment', payment.id);
      } catch (err) {
        console.error(`Removing auto-posted journal entry failed for invoice_payment ${payment.id}:`, err);
      }
    }
    if (payments.length > 0) await this.repo.remove(payments);
  }

  // Undo of a deleted payment (Activity Log > Deleted): same id and data,
  // the bank deposit and journal entry are put back and the invoice's
  // paid amount recomputed. Refused if the invoice is gone or the payment
  // no longer fits its balance due.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: String(data.invoiceId) } });
    if (!invoice) throw new BadRequestException('The invoice of this payment no longer exists - restore the invoice first.');
    const amount = this.round3(Number(data.amount));
    const paid = Number(invoice.paidAmount || 0);
    if (paid + amount > Number(invoice.total) + 0.001) {
      throw new BadRequestException(
        `Putting this payment back (${amount.toFixed(3)} OMR) would exceed what is still due on ${invoice.invoiceNumber} (${this.round3(Math.max(0, Number(invoice.total) - paid)).toFixed(3)} OMR).`,
      );
    }
    const payment = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | null = null;
      if (data.bankAccountId) {
        bankTransactionId = await applyBankMovement(manager, {
          accountId: String(data.bankAccountId),
          type: BankTransactionType.DEPOSIT,
          amount,
          date: String(data.paymentDate),
          note: `Payment received — invoice ${invoice.invoiceNumber}`,
        });
      }
      await manager.insert(InvoicePayment, { ...rowForInsert(data), amount, bankTransactionId } as any);
      return manager.findOneOrFail(InvoicePayment, { where: { id: String(data.id) } });
    });
    const all = await this.repo.find({ where: { invoiceId: invoice.id } });
    invoice.paidAmount = this.round3(all.reduce((sum, p) => sum + Number(p.amount), 0));
    invoice.paymentStatus = computePaymentStatus(invoice.paidAmount, Number(invoice.total));
    await this.invoiceRepo.save(invoice);
    await this.postJournalEntry(payment, invoice.invoiceNumber, actor);
    return payment;
  }
}
