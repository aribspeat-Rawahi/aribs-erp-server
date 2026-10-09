import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { FundTransfer, FundTransferStatus } from './fund-transfer.entity';
import { BankAccount } from './bank-account.entity';
import { BankTransaction, BankTransactionType } from './bank-transaction.entity';
import { CreateFundTransferDto, UpdateFundTransferDto } from './dto/fund-transfer.dto';
import { verifyFileSignature } from '../common/file-signature.util';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from './bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { AccountService } from '../journal/account.service';
import { applyBankMovement, rowForInsert } from '../common/bank-movement.util';
import { discardFile } from '../common/discard-file.util';
import { omanToday } from '../common/oman-date';

// Chart-of-Accounts code for the optional "Money in Transit" clearing
// account (see account.service.ts's DEFAULT_ACCOUNTS) — used only for a
// transfer created with inTransit: true.
const MONEY_IN_TRANSIT_CODE = '1350';

interface ActorRef {
  userId?: string;
  email?: string;
}

@Injectable()
export class FundTransferService {
  private uploadDir: string;

  constructor(
    @InjectRepository(FundTransfer)
    private repo: Repository<FundTransfer>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private config: ConfigService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
    private accountService: AccountService,
  ) {
    this.uploadDir = this.config.get('FUND_TRANSFER_DOCUMENT_UPLOAD_DIR') || './uploads/fund-transfer-documents';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  // Same generator convention as claimNumber/entryNumber/batchNumber.
  private generateTransferNumber() {
    const date = omanToday().replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TR-${date}-${rand}`;
  }

  // Auto-posts (or re-posts) the journal entry for a saved transfer.
  // Best-effort and separate from the main balance-moving transaction —
  // a journal-posting failure (e.g. an account somehow still unlinked)
  // never blocks the actual money movement, which already succeeded;
  // it's logged so it can be corrected from the Journals tab if it ever
  // happens.
  //
  // A COMPLETED transfer posts Dr {destination account} / Cr {source
  // account} — the normal case. An IN_TRANSIT transfer instead posts Dr
  // Money in Transit / Cr {source account}, since the destination
  // account hasn't actually received the money yet. Both use the SAME
  // (sourceType, sourceId) key, so when clear() later flips the status
  // to COMPLETED and calls this again, postForSource's regenerate-on-
  // change behavior replaces the "in transit" entry with the normal
  // one — a single entry per transfer throughout its life, not two.
  private async postJournalEntry(transfer: FundTransfer, actor: ActorRef) {
    try {
      const fromJournalAccountId = await this.bankAccountService.ensureJournalAccountId(transfer.fromAccountId);
      let debitAccountId: string;
      let debitDescription: string;
      if (transfer.status === FundTransferStatus.IN_TRANSIT) {
        const transitAccount = await this.accountService.findByCode(MONEY_IN_TRANSIT_CODE);
        if (!transitAccount) throw new Error(`Chart-of-Accounts code "${MONEY_IN_TRANSIT_CODE}" (Money in Transit) was not found.`);
        debitAccountId = transitAccount.id;
        debitDescription = 'Fund transfer in transit';
      } else {
        debitAccountId = await this.bankAccountService.ensureJournalAccountId(transfer.toAccountId);
        debitDescription = 'Fund transfer in';
      }
      await this.journalPosting.postForSource(
        'fund_transfer',
        transfer.id,
        transfer.date,
        `Fund transfer ${transfer.transferNumber}`,
        [
          { accountId: debitAccountId, debit: Number(transfer.amount), description: debitDescription },
          { accountId: fromJournalAccountId, credit: Number(transfer.amount), description: 'Fund transfer out' },
        ],
        actor,
        transfer.transferNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for fund_transfer ${transfer.id}:`, err);
    }
  }

  findAll() {
    return this.repo.find({ order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Fund transfer not found');
    return item;
  }

  // Moves money from one of our own accounts to another, atomically:
  // both accounts' balances change and both BankTransaction rows are
  // created inside a single DB transaction with row locks, mirroring the
  // pessimistic-write pattern used for stock races elsewhere in this
  // codebase (see RawMaterialService.adjustStock()).
  //
  // If dto.inTransit is true, the destination account is deliberately
  // left untouched here — only the source side happens now. The transfer
  // is created with status IN_TRANSIT and no toTransactionId; a separate
  // call to clear() later finishes crediting the destination account
  // once the money has actually arrived.
  async create(dto: CreateFundTransferDto, actor: ActorRef) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Source and destination accounts must be different');
    }
    const date = dto.date || omanToday();
    await this.journalPosting.assertDateOpen(date, 'This transfer');
    const amount = Number(dto.amount);
    const inTransit = !!dto.inTransit;

    const saved = await this.dataSource.transaction(async (manager) => {
      const fromAccount = await manager.findOne(BankAccount, {
        where: { id: dto.fromAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fromAccount) throw new NotFoundException('Source account not found');

      if (Number(fromAccount.currentBalance) < amount) {
        throw new BadRequestException(`Insufficient balance in ${fromAccount.name} for this transfer.`);
      }

      fromAccount.currentBalance = Number(fromAccount.currentBalance) - amount;
      await manager.save(fromAccount);

      let toAccount: BankAccount | null;
      let toTxn: BankTransaction | null = null;
      if (inTransit) {
        // No lock needed — only checking it exists, not mutating it yet.
        toAccount = await manager.findOne(BankAccount, { where: { id: dto.toAccountId } });
        if (!toAccount) throw new NotFoundException('Destination account not found');
      } else {
        toAccount = await manager.findOne(BankAccount, {
          where: { id: dto.toAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!toAccount) throw new NotFoundException('Destination account not found');
        toAccount.currentBalance = Number(toAccount.currentBalance) + amount;
        await manager.save(toAccount);
      }

      const fromTxn = await manager.save(
        manager.create(BankTransaction, {
          bankAccountId: fromAccount.id,
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date,
          note: inTransit ? `Fund transfer to ${toAccount.name} (in transit)` : `Fund transfer to ${toAccount.name}`,
        }),
      );
      if (!inTransit) {
        toTxn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: toAccount.id,
            type: BankTransactionType.DEPOSIT,
            amount,
            date,
            note: `Fund transfer from ${fromAccount.name}`,
          }),
        );
      }

      return manager.save(
        manager.create(FundTransfer, {
          transferNumber: this.generateTransferNumber(),
          fromAccountId: fromAccount.id,
          toAccountId: toAccount.id,
          amount,
          date,
          note: dto.note,
          status: inTransit ? FundTransferStatus.IN_TRANSIT : FundTransferStatus.COMPLETED,
          fromTransactionId: fromTxn.id,
          toTransactionId: toTxn?.id,
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        }),
      );
    });

    await this.activityLog.log({
      action: 'fund_transfer.created',
      entityType: 'fund_transfer',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: {
        transferNumber: saved.transferNumber,
        fromAccountId: saved.fromAccountId,
        toAccountId: saved.toAccountId,
        amount: saved.amount,
        status: saved.status,
      },
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }

  // Confirms an IN_TRANSIT transfer has actually arrived: credits the
  // destination account (which create() deliberately left untouched),
  // creates its DEPOSIT BankTransaction, and flips status to COMPLETED —
  // then re-posts the journal entry, which regenerates it as the normal
  // Dr {destination} / Cr {source} entry in place of the "in transit" one.
  async clear(id: string, actor: ActorRef) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(FundTransfer, { where: { id } });
      if (!item) throw new NotFoundException('Fund transfer not found');
      await this.journalPosting.assertDateOpen(item.date, 'This transfer', manager);
      if (item.status !== FundTransferStatus.IN_TRANSIT) {
        throw new BadRequestException('This transfer is not in transit — nothing to clear.');
      }

      const toAccount = await manager.findOne(BankAccount, {
        where: { id: item.toAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!toAccount) throw new NotFoundException('Destination account not found');

      toAccount.currentBalance = Number(toAccount.currentBalance) + Number(item.amount);
      await manager.save(toAccount);

      const toTxn = await manager.save(
        manager.create(BankTransaction, {
          bankAccountId: toAccount.id,
          type: BankTransactionType.DEPOSIT,
          amount: item.amount,
          date: omanToday(),
          note: `Fund transfer ${item.transferNumber} received (was in transit)`,
        }),
      );

      item.status = FundTransferStatus.COMPLETED;
      item.toTransactionId = toTxn.id;
      item.clearedDate = omanToday();
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'fund_transfer.cleared',
      entityType: 'fund_transfer',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { transferNumber: saved.transferNumber, toAccountId: saved.toAccountId, amount: saved.amount },
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }

  // Reverses the transfer's old effect (guarding that the destination
  // account has enough balance left to give the money back — it may
  // have already been spent elsewhere) and re-applies it with the new
  // values, all inside one DB transaction so a mid-way failure never
  // leaves the accounts half-updated.
  //
  // Editing never changes IN_TRANSIT ↔ COMPLETED — that's only done via
  // clear(). A still-IN_TRANSIT transfer only ever touches the source
  // account (the destination was never credited, so there's nothing to
  // reverse or re-apply there); an already-COMPLETED transfer (whether
  // it was created that way or has since been cleared) reverses and
  // re-applies both sides, same as before this feature existed.
  async update(id: string, dto: UpdateFundTransferDto, actor: ActorRef) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(FundTransfer, { where: { id } });
      if (!item) throw new NotFoundException('Fund transfer not found');
      await this.journalPosting.assertDateOpen(item.date, 'This transfer', manager);
      // the new date must be open too, or the books move into a closed period
      if (dto.date) await this.journalPosting.assertDateOpen(dto.date, 'The new transfer date', manager);
      const wasInTransit = item.status === FundTransferStatus.IN_TRANSIT;

      const oldFrom = await manager.findOne(BankAccount, {
        where: { id: item.fromAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      const oldTo = wasInTransit
        ? null
        : await manager.findOne(BankAccount, {
            where: { id: item.toAccountId },
            lock: { mode: 'pessimistic_write' },
          });

      // Reverse the old effect.
      if (oldFrom) {
        oldFrom.currentBalance = Number(oldFrom.currentBalance) + Number(item.amount);
        await manager.save(oldFrom);
      }
      if (oldTo) {
        const reversedBalance = Number(oldTo.currentBalance) - Number(item.amount);
        if (reversedBalance < 0) {
          throw new BadRequestException(
            `Cannot edit this transfer — reversing it would leave ${oldTo.name} negative (funds already used elsewhere).`,
          );
        }
        oldTo.currentBalance = reversedBalance;
        await manager.save(oldTo);
      }
      if (item.fromTransactionId) await manager.delete(BankTransaction, item.fromTransactionId);
      if (item.toTransactionId) await manager.delete(BankTransaction, item.toTransactionId);

      // Apply the new effect.
      const fromAccountId = dto.fromAccountId ?? item.fromAccountId;
      const toAccountId = dto.toAccountId ?? item.toAccountId;
      if (fromAccountId === toAccountId) {
        throw new BadRequestException('Source and destination accounts must be different');
      }
      const amount = dto.amount != null ? Number(dto.amount) : Number(item.amount);
      const date = dto.date ?? item.date;

      const newFrom =
        fromAccountId === oldFrom?.id
          ? oldFrom
          : await manager.findOne(BankAccount, { where: { id: fromAccountId }, lock: { mode: 'pessimistic_write' } });
      if (!newFrom) throw new NotFoundException('Source account not found');

      if (Number(newFrom.currentBalance) < amount) {
        throw new BadRequestException(`Insufficient balance in ${newFrom.name} for this transfer.`);
      }
      newFrom.currentBalance = Number(newFrom.currentBalance) - amount;
      await manager.save(newFrom);

      let toTxnId: string | undefined;
      let toAccountName: string;
      if (wasInTransit) {
        // Destination still untouched — just confirm it exists.
        const newTo = await manager.findOne(BankAccount, { where: { id: toAccountId } });
        if (!newTo) throw new NotFoundException('Destination account not found');
        toAccountName = newTo.name;
      } else {
        const newTo =
          toAccountId === oldTo?.id
            ? oldTo
            : await manager.findOne(BankAccount, { where: { id: toAccountId }, lock: { mode: 'pessimistic_write' } });
        if (!newTo) throw new NotFoundException('Destination account not found');
        newTo.currentBalance = Number(newTo.currentBalance) + amount;
        await manager.save(newTo);
        const toTxn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: newTo.id,
            type: BankTransactionType.DEPOSIT,
            amount,
            date,
            note: `Fund transfer from ${newFrom.name}`,
          }),
        );
        toTxnId = toTxn.id;
        toAccountName = newTo.name;
      }

      const fromTxn = await manager.save(
        manager.create(BankTransaction, {
          bankAccountId: newFrom.id,
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date,
          note: wasInTransit ? `Fund transfer to ${toAccountName} (in transit)` : `Fund transfer to ${toAccountName}`,
        }),
      );

      item.fromAccountId = fromAccountId;
      item.toAccountId = toAccountId;
      item.amount = amount;
      item.date = date;
      item.note = dto.note !== undefined ? dto.note : item.note;
      item.fromTransactionId = fromTxn.id;
      item.toTransactionId = toTxnId;
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'fund_transfer.updated',
      entityType: 'fund_transfer',
      entityId: saved.id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { transferNumber: saved.transferNumber, fromAccountId: saved.fromAccountId, toAccountId: saved.toAccountId, amount: saved.amount },
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }

  async remove(id: string, actor: ActorRef) {
    const removed = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(FundTransfer, { where: { id } });
      if (!item) throw new NotFoundException('Fund transfer not found');
      await this.journalPosting.assertDateOpen(item.date, 'This transfer', manager, { existing: true });
      // An IN_TRANSIT transfer never credited the destination account, so
      // there is nothing to reverse on that side (and no toTransactionId).
      const wasInTransit = item.status === FundTransferStatus.IN_TRANSIT;

      const fromAccount = await manager.findOne(BankAccount, {
        where: { id: item.fromAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      const toAccount = wasInTransit
        ? null
        : await manager.findOne(BankAccount, {
            where: { id: item.toAccountId },
            lock: { mode: 'pessimistic_write' },
          });

      if (fromAccount) {
        fromAccount.currentBalance = Number(fromAccount.currentBalance) + Number(item.amount);
        await manager.save(fromAccount);
      }
      if (toAccount) {
        const reversedBalance = Number(toAccount.currentBalance) - Number(item.amount);
        if (reversedBalance < 0) {
          throw new BadRequestException(
            `Cannot delete this transfer — reversing it would leave ${toAccount.name} negative (funds already used elsewhere).`,
          );
        }
        toAccount.currentBalance = reversedBalance;
        await manager.save(toAccount);
      }
      if (item.fromTransactionId) await manager.delete(BankTransaction, item.fromTransactionId);
      if (item.toTransactionId) await manager.delete(BankTransaction, item.toTransactionId);

      // parked, not deleted, so "Undo" can bring it back
      discardFile(item.documentFilePath);
      await manager.remove(item);
      return item;
    });

    await this.activityLog.log({
      action: 'fund_transfer.deleted',
      entityType: 'fund_transfer',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { transferNumber: removed.transferNumber, fromAccountId: removed.fromAccountId, toAccountId: removed.toAccountId, amount: removed.amount },
    });
    try {
      await this.journalPosting.removeForSource('fund_transfer', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for fund_transfer ${id}:`, err);
    }
    return { deleted: true };
  }

  // Saves/replaces the supporting document (transfer slip, bank
  // confirmation, etc.) for this transfer — same magic-byte pattern as
  // Expense/Reimbursement.
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
      throw new NotFoundException('No document uploaded for this transfer');
    }
    return path.resolve(item.documentFilePath);
  }

  // Undo of a deleted transfer: same id/number/date; the withdrawal (and
  // the deposit, if it had arrived) and the journal entry are put back.
  async restoreDeleted(data: Record<string, unknown>, actor: ActorRef = {}) {
    const amount = Number(data.amount);
    const date = String(data.date);
    const inTransit = data.status === FundTransferStatus.IN_TRANSIT;
    const saved = await this.dataSource.transaction(async (manager) => {
      const from = await manager.findOne(BankAccount, { where: { id: String(data.fromAccountId) } });
      const to = await manager.findOne(BankAccount, { where: { id: String(data.toAccountId) } });
      if (!from || !to) throw new BadRequestException('One of the accounts of this transfer no longer exists - restore it first.');
      const fromTransactionId = await applyBankMovement(manager, {
        accountId: from.id,
        type: BankTransactionType.WITHDRAWAL,
        amount,
        date,
        note: inTransit ? `Fund transfer to ${to.name} (in transit)` : `Fund transfer to ${to.name}`,
      });
      const toTransactionId = inTransit
        ? null
        : await applyBankMovement(manager, { accountId: to.id, type: BankTransactionType.DEPOSIT, amount, date, note: `Fund transfer from ${from.name}` });
      await manager.insert(FundTransfer, { ...rowForInsert(data), fromTransactionId, toTransactionId } as any);
      return manager.findOneOrFail(FundTransfer, { where: { id: String(data.id) } });
    });
    await this.postJournalEntry(saved, actor);
    return saved;
  }
}
