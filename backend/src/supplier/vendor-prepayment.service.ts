import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { VendorPrepayment } from './vendor-prepayment.entity';
import { VendorPrepaymentApplication } from './vendor-prepayment-application.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreateVendorPrepaymentDto, ApplyVendorPrepaymentDto } from './dto/vendor-prepayment.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

const VENDOR_PREPAYMENTS_CODE = '1310';
const ACCOUNTS_PAYABLE_CODE = '2000';

@Injectable()
export class VendorPrepaymentService {
  constructor(
    @InjectRepository(VendorPrepayment)
    private repo: Repository<VendorPrepayment>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  private generateNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `VP-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ relations: ['applications'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['applications'] });
    if (!item) throw new NotFoundException('Vendor prepayment not found');
    return item;
  }

  // Pays the advance from a bank/cash account (pessimistic-locked, same
  // as FundTransfer/FixedAsset) and immediately posts Dr 1310 / Cr {bank}.
  async create(dto: CreateVendorPrepaymentDto, actor: ActorRef) {
    const date = dto.date || new Date().toISOString().slice(0, 10);
    const amount = Number(dto.amount);

    const saved = await this.dataSource.transaction(async (manager) => {
      const account = await manager.findOne(BankAccount, {
        where: { id: dto.bankAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException('Bank/cash account not found');
      if (Number(account.currentBalance) < amount) {
        throw new BadRequestException(`Insufficient balance in ${account.name} for this prepayment.`);
      }
      account.currentBalance = Number(account.currentBalance) - amount;
      await manager.save(account);
      const txn = await manager.save(
        manager.create(BankTransaction, {
          bankAccountId: account.id,
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date,
          note: 'Vendor prepayment',
        }),
      );

      return manager.save(
        manager.create(VendorPrepayment, {
          prepaymentNumber: this.generateNumber(),
          supplierId: dto.supplierId,
          amount,
          date,
          bankAccountId: dto.bankAccountId,
          bankTransactionId: txn.id,
          appliedAmount: 0,
          note: dto.note,
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        }),
      );
    });

    await this.activityLog.log({
      action: 'vendor_prepayment.created',
      entityType: 'vendor_prepayment',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { prepaymentNumber: saved.prepaymentNumber, supplierId: saved.supplierId, amount: saved.amount },
    });

    await this.postPrepaymentJournal(saved, actor);

    return this.findOne(saved.id);
  }

  // Applies (part of) this prepayment against Accounts Payable — the cash
  // already left when create() ran, so this is a pure balance-sheet
  // reclassification: Dr 2000 AP / Cr 1310 Vendor Prepayments. Each
  // application gets its own row (and its own auto-posted Journal Entry,
  // keyed by that row's id) so applying the same prepayment several times
  // against different bills never overwrites an earlier entry.
  async apply(id: string, dto: ApplyVendorPrepaymentDto, actor: ActorRef) {
    const item = await this.findOne(id);
    const remaining = this.round3(Number(item.amount) - Number(item.appliedAmount));
    const amount = Number(dto.amount);
    if (amount > remaining + 0.001) {
      throw new BadRequestException(`Cannot apply ${amount} — only ${remaining} of this prepayment remains unapplied.`);
    }
    const date = dto.date || new Date().toISOString().slice(0, 10);

    const application = await this.dataSource.transaction(async (manager) => {
      item.appliedAmount = this.round3(Number(item.appliedAmount) + amount);
      await manager.save(item);
      return manager.save(
        manager.create(VendorPrepaymentApplication, {
          vendorPrepaymentId: item.id,
          amount,
          date,
          purchaseOrderId: dto.purchaseOrderId,
          note: dto.note,
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        }),
      );
    });

    await this.activityLog.log({
      action: 'vendor_prepayment.applied',
      entityType: 'vendor_prepayment',
      entityId: item.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { prepaymentNumber: item.prepaymentNumber, amount, applicationId: application.id },
    });

    try {
      const prepaymentAccountId = await this.journalPosting.findAccountIdByCode(VENDOR_PREPAYMENTS_CODE);
      const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
      await this.journalPosting.postForSource(
        'vendor_prepayment_application',
        application.id,
        date,
        `Vendor prepayment applied — ${item.prepaymentNumber}`,
        [
          { accountId: apAccountId, debit: amount, description: 'Prepayment applied against payable' },
          { accountId: prepaymentAccountId, credit: amount, description: 'Prepayment used' },
        ],
        actor,
        item.prepaymentNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for vendor_prepayment_application ${application.id}:`, err);
    }

    return this.findOne(id);
  }

  // Only reversible while nothing has been applied yet — once even part
  // of it has been used against a bill, that application's own Journal
  // Entry (and the AP relief it represents) must stay intact.
  async remove(id: string, actor: ActorRef) {
    const item = await this.findOne(id);
    if (Number(item.appliedAmount) > 0) {
      throw new BadRequestException('This prepayment has already been applied — it can no longer be deleted.');
    }

    await this.dataSource.transaction(async (manager) => {
      const account = await manager.findOne(BankAccount, {
        where: { id: item.bankAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (account) {
        account.currentBalance = Number(account.currentBalance) + Number(item.amount);
        await manager.save(account);
        await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.DEPOSIT,
            amount: Number(item.amount),
            date: new Date().toISOString().slice(0, 10),
            note: `Vendor prepayment reversed — ${item.prepaymentNumber}`,
          }),
        );
      }
      await manager.remove(item);
    });

    await this.activityLog.log({
      action: 'vendor_prepayment.deleted',
      entityType: 'vendor_prepayment',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { prepaymentNumber: item.prepaymentNumber, supplierId: item.supplierId, amount: item.amount },
    });

    try {
      await this.journalPosting.removeForSource('vendor_prepayment', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for vendor_prepayment ${id}:`, err);
    }
    return { deleted: true };
  }

  // Dr Vendor Prepayments (asset) / Cr the bank account it was paid from.
  private async postPrepaymentJournal(saved: VendorPrepayment, actor: ActorRef) {
    try {
      const amount = Number(saved.amount);
      const prepaymentAccountId = await this.journalPosting.findAccountIdByCode(VENDOR_PREPAYMENTS_CODE);
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
      await this.journalPosting.postForSource(
        'vendor_prepayment',
        saved.id,
        saved.date,
        `Vendor prepayment ${saved.prepaymentNumber}`,
        [
          { accountId: prepaymentAccountId, debit: amount, description: 'Advance paid to supplier' },
          { accountId: bankJournalAccountId, credit: amount, description: 'Prepayment paid out' },
        ],
        actor,
        saved.prepaymentNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for vendor_prepayment ${saved.id}:`, err);
    }
  }

  // Undo of a deleted (never used) prepayment: same id/number/date. The
  // delete put the money back with a reversal deposit (kept in the bank
  // history), so the undo takes it out again with a new withdrawal and
  // re-posts the journal entry.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const bankTransactionId = await applyBankMovement(manager, {
        accountId: String(data.bankAccountId),
        type: BankTransactionType.WITHDRAWAL,
        amount: Number(data.amount),
        date: String(data.date),
        note: `Vendor prepayment ${data.prepaymentNumber} (restored)`,
      });
      await manager.insert(VendorPrepayment, { ...rowForInsert(data), appliedAmount: 0, bankTransactionId } as any);
      return manager.findOneOrFail(VendorPrepayment, { where: { id: String(data.id) } });
    });
    await this.postPrepaymentJournal(saved, actor);
    return saved;
  }
}
