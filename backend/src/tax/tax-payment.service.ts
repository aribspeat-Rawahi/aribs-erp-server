import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { TaxPayment } from './tax-payment.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreateTaxPaymentDto, UpdateTaxPaymentDto } from './dto/tax-payment.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';
import { discardFile } from '../common/discard-file.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Auto-posted VAT-Payable account code (Dr side of every tax payment
// with a bank/cash leg — see postJournalEntry()). Kept as a local
// constant rather than a shared enum since this is the only place it's
// needed; matches the DEFAULT_ACCOUNTS seed in journal/account.service.ts.
const VAT_PAYABLE_CODE = '2100';

@Injectable()
export class TaxPaymentService {
  private uploadDir: string;

  constructor(
    @InjectRepository(TaxPayment)
    private repo: Repository<TaxPayment>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private config: ConfigService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {
    this.uploadDir = this.config.get('TAX_PAYMENT_DOCUMENT_UPLOAD_DIR') || './uploads/tax-payment-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // Same generator convention as claimNumber/entryNumber/transferNumber.
  private generatePaymentNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TX-${date}-${rand}`;
  }

  // Auto-posts (or re-posts, or removes) Dr 2100 VAT Payable / Cr
  // {linked bank/cash account} for a saved tax payment — only when it
  // has a bank/cash leg (a record-only payment with no bankAccountId
  // isn't a real cash movement, so nothing to post). Best-effort and
  // separate from the main transaction, same reasoning as
  // FundTransferService.postJournalEntry().
  private async postJournalEntry(payment: TaxPayment, actor: ActorRef) {
    try {
      if (!payment.bankAccountId) {
        await this.journalPosting.removeForSource('tax_payment', payment.id);
        return;
      }
      const vatPayableAccountId = await this.journalPosting.findAccountIdByCode(VAT_PAYABLE_CODE);
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(payment.bankAccountId);
      await this.journalPosting.postForSource(
        'tax_payment',
        payment.id,
        payment.datePaid,
        `Tax payment ${payment.paymentNumber} — ${payment.period}`,
        [
          { accountId: vatPayableAccountId, debit: Number(payment.amount), description: 'VAT payment' },
          { accountId: bankJournalAccountId, credit: Number(payment.amount), description: 'Tax payment' },
        ],
        actor,
        payment.paymentNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for tax_payment ${payment.id}:`, err);
    }
  }

  findAll() {
    return this.repo.find({ order: { datePaid: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Tax payment not found');
    return item;
  }

  // Optionally records a real bank/cash withdrawal (like
  // Reimbursement.markPaid()) inside the same DB transaction as the
  // TaxPayment row, with a row lock on the account so two concurrent
  // payments can't both pass the balance check.
  async create(dto: CreateTaxPaymentDto, actor: ActorRef) {
    const date = dto.datePaid || new Date().toISOString().slice(0, 10);
    const amount = Number(dto.amount);

    const saved = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | undefined;
      if (dto.bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: dto.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < amount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} for this tax payment.`);
        }
        account.currentBalance = Number(account.currentBalance) - amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount,
            date,
            note: `Tax payment — ${dto.period}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      return manager.save(
        manager.create(TaxPayment, {
          paymentNumber: this.generatePaymentNumber(),
          period: dto.period,
          amount,
          datePaid: date,
          reference: dto.reference,
          note: dto.note,
          bankAccountId: dto.bankAccountId,
          bankTransactionId,
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        }),
      );
    });

    await this.activityLog.log({
      action: 'tax_payment.created',
      entityType: 'tax_payment',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { paymentNumber: saved.paymentNumber, period: saved.period, amount: saved.amount },
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }

  // Reverses any old bank-sync effect first (guarded — refuses if the
  // account no longer has enough balance to give the money back, i.e. it
  // was already spent elsewhere), then re-applies with the new values —
  // same reversal pattern as FundTransferService.update().
  async update(id: string, dto: UpdateTaxPaymentDto, actor: ActorRef) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TaxPayment, { where: { id } });
      if (!item) throw new NotFoundException('Tax payment not found');

      if (item.bankAccountId && item.bankTransactionId) {
        const oldAccount = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (oldAccount) {
          const reversedBalance = Number(oldAccount.currentBalance) + Number(item.amount);
          oldAccount.currentBalance = reversedBalance;
          await manager.save(oldAccount);
        }
        await manager.delete(BankTransaction, item.bankTransactionId);
      }

      const period = dto.period ?? item.period;
      const amount = dto.amount != null ? Number(dto.amount) : Number(item.amount);
      const date = dto.datePaid ?? item.datePaid;
      const bankAccountId = dto.bankAccountId !== undefined ? dto.bankAccountId : item.bankAccountId;

      let bankTransactionId: string | undefined;
      if (bankAccountId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < amount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} for this tax payment.`);
        }
        account.currentBalance = Number(account.currentBalance) - amount;
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount,
            date,
            note: `Tax payment — ${period}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      item.period = period;
      item.amount = amount;
      item.datePaid = date;
      item.reference = dto.reference !== undefined ? dto.reference : item.reference;
      item.note = dto.note !== undefined ? dto.note : item.note;
      item.bankAccountId = bankAccountId;
      item.bankTransactionId = bankTransactionId;
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'tax_payment.updated',
      entityType: 'tax_payment',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { paymentNumber: saved.paymentNumber, period: saved.period, amount: saved.amount },
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }

  async remove(id: string, actor: ActorRef) {
    const removed = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TaxPayment, { where: { id } });
      if (!item) throw new NotFoundException('Tax payment not found');

      if (item.bankAccountId && item.bankTransactionId) {
        const account = await manager.findOne(BankAccount, {
          where: { id: item.bankAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (account) {
          account.currentBalance = Number(account.currentBalance) + Number(item.amount);
          await manager.save(account);
        }
        await manager.delete(BankTransaction, item.bankTransactionId);
      }

      // parked, not deleted, so "Undo" can bring it back
      discardFile(item.documentFilePath);
      await manager.remove(item);
      return item;
    });

    await this.activityLog.log({
      action: 'tax_payment.deleted',
      entityType: 'tax_payment',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { paymentNumber: removed.paymentNumber, period: removed.period, amount: removed.amount },
    });
    try {
      await this.journalPosting.removeForSource('tax_payment', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for tax_payment ${id}:`, err);
    }
    return { deleted: true };
  }

  // Same magic-byte upload pattern as Expense/Reimbursement/FundTransfer.
  async saveDocumentFile(id: string, file: Express.Multer.File) {
    const item = await this.findOne(id);
    const { extension: ext } = verifyFileSignature(file.buffer, ['pdf', 'jpeg', 'png']);
    const fileName = `${id}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    if (item.documentFilePath && item.documentFilePath !== filePath && fs.existsSync(item.documentFilePath)) {
      fs.unlinkSync(item.documentFilePath);
    }

    fs.writeFileSync(filePath, file.buffer);
    item.documentFilePath = filePath;
    return this.repo.save(item);
  }

  async getDocumentFilePath(id: string): Promise<string> {
    const item = await this.findOne(id);
    if (!item.documentFilePath || !fs.existsSync(item.documentFilePath)) {
      throw new NotFoundException('No document uploaded for this tax payment');
    }
    return path.resolve(item.documentFilePath);
  }

  // Undo of a deleted tax payment: same id/number/date; the bank
  // withdrawal and the journal entry (Dr VAT Payable / Cr bank) come back.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const amount = Number(data.amount);
    const saved = await this.dataSource.transaction(async (manager) => {
      let bankTransactionId: string | null = null;
      if (data.bankAccountId) {
        bankTransactionId = await applyBankMovement(manager, {
          accountId: String(data.bankAccountId),
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date: String(data.datePaid),
          note: `Tax payment — ${data.period}`,
        });
      }
      await manager.insert(TaxPayment, { ...rowForInsert(data), bankTransactionId } as any);
      return manager.findOneOrFail(TaxPayment, { where: { id: String(data.id) } });
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }
}
