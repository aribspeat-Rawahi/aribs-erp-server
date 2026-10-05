import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { VendorCredit } from './vendor-credit.entity';
import { VendorCreditApplication } from './vendor-credit-application.entity';
import { VendorCreditRefund } from './vendor-credit-refund.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreateVendorCreditDto, ApplyVendorCreditDto, RefundVendorCreditDto } from './dto/vendor-credit.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { rowForInsert } from '../common/bank-movement.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

const ACCOUNTS_PAYABLE_CODE = '2000';
// Same contra account PurchaseReturnService uses (1200, an ASSET) — a
// vendor credit is economically the same thing as a purchase return for
// posting purposes. Previously this credited 1408 "Purchase Return",
// which is typed REVENUE in the Chart of Accounts — that silently
// inflated Total Revenue/Net Profit on the Income Statement by the value
// of every vendor credit issued (and its refund). Fixed 2026-09-25 to
// match the same fix already applied to purchase-return.service.ts.
const INVENTORY_RAW_MATERIALS_CODE = '1200';

@Injectable()
export class VendorCreditService {
  constructor(
    @InjectRepository(VendorCredit)
    private repo: Repository<VendorCredit>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  private generateNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `VC-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ relations: ['applications', 'refunds'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['applications', 'refunds'] });
    if (!item) throw new NotFoundException('Vendor credit not found');
    return item;
  }

  // Issuing the credit reduces Accounts Payable right away — Dr 2000 / Cr
  // 1200 (Inventory — Raw Materials) — no bank/cash movement at this step.
  async create(dto: CreateVendorCreditDto, actor: ActorRef) {
    const date = dto.date || new Date().toISOString().slice(0, 10);
    const amount = Number(dto.amount);

    const saved = await this.repo.save(
      this.repo.create({
        creditNumber: this.generateNumber(),
        supplierId: dto.supplierId,
        amount,
        date,
        reason: dto.reason,
        appliedAmount: 0,
        refundedAmount: 0,
        createdByUserId: actor.userId,
        createdByEmail: actor.email,
      }),
    );

    await this.activityLog.log({
      action: 'vendor_credit.created',
      entityType: 'vendor_credit',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { creditNumber: saved.creditNumber, supplierId: saved.supplierId, amount: saved.amount },
    });

    await this.postCreditJournal(saved, actor);

    return this.findOne(saved.id);
  }

  private remaining(item: VendorCredit) {
    return this.round3(Number(item.amount) - Number(item.appliedAmount) - Number(item.refundedAmount));
  }

  // Tracking-only — no Journal Entry, since the credit already reduced AP
  // in full at creation (see this service's class-level comment).
  async apply(id: string, dto: ApplyVendorCreditDto, actor: ActorRef) {
    const item = await this.findOne(id);
    const remaining = this.remaining(item);
    const amount = Number(dto.amount);
    if (amount > remaining + 0.001) {
      throw new BadRequestException(`Cannot apply ${amount} — only ${remaining} of this credit remains unused.`);
    }
    const date = dto.date || new Date().toISOString().slice(0, 10);

    await this.dataSource.transaction(async (manager) => {
      item.appliedAmount = this.round3(Number(item.appliedAmount) + amount);
      await manager.save(item);
      await manager.save(
        manager.create(VendorCreditApplication, {
          vendorCreditId: item.id,
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
      action: 'vendor_credit.applied',
      entityType: 'vendor_credit',
      entityId: item.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { creditNumber: item.creditNumber, amount },
    });

    return this.findOne(id);
  }

  // The supplier pays actual cash back instead: Dr {bank} / Cr 2000 AP.
  // Combined with the Dr AP / Cr 1200 already posted at creation, the net
  // effect across both entries is Dr {bank} / Cr 1200 — a real cash
  // refund with AP left unchanged overall, which is the correct result.
  async refund(id: string, dto: RefundVendorCreditDto, actor: ActorRef) {
    const item = await this.findOne(id);
    const remaining = this.remaining(item);
    const amount = Number(dto.amount);
    if (amount > remaining + 0.001) {
      throw new BadRequestException(`Cannot refund ${amount} — only ${remaining} of this credit remains unused.`);
    }
    const date = dto.date || new Date().toISOString().slice(0, 10);

    const refund = await this.dataSource.transaction(async (manager) => {
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
          date,
          note: `Vendor credit refund — ${item.creditNumber}`,
        }),
      );

      item.refundedAmount = this.round3(Number(item.refundedAmount) + amount);
      await manager.save(item);

      return manager.save(
        manager.create(VendorCreditRefund, {
          vendorCreditId: item.id,
          amount,
          date,
          bankAccountId: dto.bankAccountId,
          bankTransactionId: txn.id,
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        }),
      );
    });

    await this.activityLog.log({
      action: 'vendor_credit.refunded',
      entityType: 'vendor_credit',
      entityId: item.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { creditNumber: item.creditNumber, amount, refundId: refund.id },
    });

    try {
      const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
      const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(dto.bankAccountId);
      await this.journalPosting.postForSource(
        'vendor_credit_refund',
        refund.id,
        date,
        `Vendor credit refund — ${item.creditNumber}`,
        [
          { accountId: bankJournalAccountId, debit: amount, description: 'Vendor credit refunded in cash' },
          { accountId: apAccountId, credit: amount, description: 'Reverses credit issued at creation' },
        ],
        actor,
        item.creditNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for vendor_credit_refund ${refund.id}:`, err);
    }

    return this.findOne(id);
  }

  // Only reversible before anything has been applied or refunded.
  async remove(id: string, actor: ActorRef) {
    const item = await this.findOne(id);
    if (Number(item.appliedAmount) > 0 || Number(item.refundedAmount) > 0) {
      throw new BadRequestException('This credit has already been applied or refunded — it can no longer be deleted.');
    }
    await this.repo.remove(item);

    await this.activityLog.log({
      action: 'vendor_credit.deleted',
      entityType: 'vendor_credit',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { creditNumber: item.creditNumber, supplierId: item.supplierId, amount: item.amount },
    });

    try {
      await this.journalPosting.removeForSource('vendor_credit', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for vendor_credit ${id}:`, err);
    }
    return { deleted: true };
  }

  // Dr Accounts Payable / Cr Raw Materials Inventory for the credit.
  private async postCreditJournal(saved: VendorCredit, actor: ActorRef) {
    try {
      const amount = Number(saved.amount);
      const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
      const creditAccountId = await this.journalPosting.findAccountIdByCode(INVENTORY_RAW_MATERIALS_CODE);
      await this.journalPosting.postForSource(
        'vendor_credit',
        saved.id,
        saved.date,
        `Vendor credit ${saved.creditNumber}`,
        [
          { accountId: apAccountId, debit: amount, description: 'Vendor credit received' },
          { accountId: creditAccountId, credit: amount, description: 'Vendor credit received' },
        ],
        actor,
        saved.creditNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for vendor_credit ${saved.id}:`, err);
    }
  }

  // Undo of a deleted (never used) vendor credit: same id/number; its
  // journal entry is posted again. No money moves.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    await this.repo.insert({ ...rowForInsert(data), appliedAmount: 0, refundedAmount: 0 } as any);
    const saved = await this.repo.findOneOrFail({ where: { id: String(data.id) } });
    await this.postCreditJournal(saved, actor);
    return saved;
  }
}
