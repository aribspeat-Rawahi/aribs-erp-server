import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Settings } from '../settings/settings.entity';
import { VatPeriod, VatPeriodStatus } from '../vat-period/vat-period.entity';
import { JournalEntry } from './journal-entry.entity';
import { JournalEntryLine } from './journal-entry-line.entity';
import { Account } from './account.entity';

export interface PostingLine {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
}

interface ActorRef {
  userId?: string;
  email?: string;
}

// Auto-posting double-entry — turns Expense/Invoice/Reimbursement/Fund
// Transfer/Tax Payment records into real Journal Entries against the
// Chart of Accounts, so the Trial Balance reflects day-to-day operations
// instead of only whatever was entered manually from the Journals tab.
//
// Unlike a manual Journal Entry (see JournalEntryService), an
// auto-posted entry is tied to its source record (sourceType/sourceId)
// and is *regenerated* — old entry deleted, new one created — every time
// its source is created/edited, rather than reversed line by line. A
// Journal Entry has no standalone running balance the way a BankAccount
// does, so wholesale regeneration is simpler than reversal and just as
// correct; it also means editing a source's amount twice in a row can
// never leave two stale entries behind.
//
// Uses the shared DataSource directly (no repository injection, no
// module import of JournalModule needed by callers beyond this
// service's own export) — same pattern as RawMaterialService.adjustStock()
// and FundTransferService.
@Injectable()
export class JournalPostingService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  private generateEntryNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `JE-${date}-${rand}`;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // The last day of the closed books, or null. The books are closed up to
  // the later of: the opening balance date (once finalized) and the end
  // of the last VAT return marked as filed.
  async lockInfo(manager: EntityManager = this.dataSource.manager): Promise<{ date: string; reason: string } | null> {
    const s = await manager.findOne(Settings, { where: { id: 1 } });
    let best: { date: string; reason: string } | null =
      s?.openingBalanceFinalizedAt && s.openingBalanceDate
        ? { date: String(s.openingBalanceDate).slice(0, 10), reason: 'opening balance date' }
        : null;
    const filed = await manager.findOne(VatPeriod, { where: { status: VatPeriodStatus.FILED }, order: { endDate: 'DESC' } });
    if (filed) {
      const end = String(filed.endDate).slice(0, 10);
      if (!best || end > best.date) best = { date: end, reason: `${filed.label} return is filed` };
    }
    return best;
  }

  async lockedThrough(manager: EntityManager = this.dataSource.manager): Promise<string | null> {
    return (await this.lockInfo(manager))?.date || null;
  }

  // Call BEFORE saving anything dated, so a record is never half-saved.
  async assertDateOpen(date: string | Date | null | undefined, what = 'This entry', manager?: EntityManager): Promise<void> {
    if (!date) return;
    const lock = await this.lockInfo(manager);
    const d = (date instanceof Date ? date.toISOString() : String(date)).slice(0, 10);
    if (lock && d <= lock.date) {
      throw new BadRequestException(
        `${what} is dated ${d}, but the books are closed up to ${lock.date} (${lock.reason}). Use a later date.`,
      );
    }
  }

  async findAccountIdByCode(code: string): Promise<string> {
    const account = await this.dataSource.manager.findOne(Account, { where: { code } });
    if (!account) {
      throw new Error(`Auto-posting failed — Chart-of-Accounts code "${code}" was not found. Check the Chart of Accounts tab.`);
    }
    return account.id;
  }

  // Deletes any existing auto-posted entry for this source, then (if
  // `lines` is non-empty) creates a fresh balanced one. Pass an empty
  // `lines` array to just remove the old entry — e.g. when a source no
  // longer qualifies for auto-posting (its bank/cash account link was
  // removed, or an optional leg like a tax payment's bank sync was
  // cleared). Returns the new entry, or null if only a removal happened.
  async postForSource(
    sourceType: string,
    sourceId: string,
    date: string,
    memo: string,
    lines: PostingLine[],
    actor: ActorRef,
    reference?: string,
    outerManager?: EntityManager,
  ): Promise<JournalEntry | null> {
    const run = async (manager: EntityManager) => {
      const existing = await manager.findOne(JournalEntry, { where: { sourceType, sourceId } });
      // Closed books: neither a new entry nor a change to an old one may
      // land on or before the opening balance date (safety net - services
      // also check before saving their own record).
      if (sourceType !== 'opening_balance') {
        if (lines.length) await this.assertDateOpen(date, 'This entry', manager);
        if (existing) await this.assertDateOpen(existing.date, 'The existing journal entry', manager);
      }
      if (existing) {
        await manager.delete(JournalEntryLine, { journalEntryId: existing.id });
        await manager.delete(JournalEntry, { id: existing.id });
      }

      if (lines.length === 0) return null;

      let totalDebit = 0;
      let totalCredit = 0;
      for (const l of lines) {
        totalDebit += Number(l.debit || 0);
        totalCredit += Number(l.credit || 0);
      }
      // A mismatch here is a bug in the calling service's line-building
      // logic, not something a user did — fail loudly instead of posting
      // an unbalanced entry.
      if (this.round3(totalDebit) !== this.round3(totalCredit)) {
        throw new Error(
          `Auto-posting for ${sourceType} ${sourceId} is not balanced (debit ${totalDebit}, credit ${totalCredit})`,
        );
      }

      const entry = manager.create(JournalEntry, {
        entryNumber: this.generateEntryNumber(),
        date,
        reference,
        memo,
        autoPosted: true,
        sourceType,
        sourceId,
        createdByUserId: actor.userId,
        createdByEmail: actor.email,
        lines: lines.map((l) =>
          manager.create(JournalEntryLine, {
            accountId: l.accountId,
            debit: Number(l.debit || 0),
            credit: Number(l.credit || 0),
            description: l.description,
          }),
        ),
      });
      return manager.save(entry);
    };
    return outerManager ? run(outerManager) : this.dataSource.transaction(run);
  }

  async removeForSource(sourceType: string, sourceId: string) {
    const existing = await this.dataSource.manager.findOne(JournalEntry, { where: { sourceType, sourceId } });
    if (!existing) return;
    if (sourceType !== 'opening_balance') await this.assertDateOpen(existing.date, 'The journal entry being removed');
    await this.dataSource.manager.delete(JournalEntryLine, { journalEntryId: existing.id });
    await this.dataSource.manager.delete(JournalEntry, { id: existing.id });
  }
}
