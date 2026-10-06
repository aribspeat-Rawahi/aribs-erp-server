import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, LessThanOrEqual } from 'typeorm';
import { JournalEntry } from './journal-entry.entity';
import { JournalEntryLine } from './journal-entry-line.entity';
import { Account, AccountType } from './account.entity';
import { CreateJournalEntryDto } from './dto/journal-entry.dto';
import { JournalPostingService } from './journal-posting.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

interface ActorRef {
  userId?: string;
  email?: string;
}

@Injectable()
export class JournalEntryService {
  constructor(
    @InjectRepository(JournalEntry)
    private repo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private lineRepo: Repository<JournalEntryLine>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    private activityLog: ActivityLogService,
    private journalPosting: JournalPostingService,
  ) {}

  // Same generator convention as Reimbursement.claimNumber / batch numbers.
  private generateEntryNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `JE-${date}-${rand}`;
  }

  findAll() {
    return this.repo.find({ relations: ['lines'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['lines'] });
    if (!item) throw new NotFoundException('Journal entry not found');
    return item;
  }

  async create(dto: CreateJournalEntryDto, createdBy: ActorRef) {
    await this.journalPosting.assertDateOpen(dto.date || new Date().toISOString().slice(0, 10), 'This journal entry');
    // Every line must be a pure Debit or a pure Credit (not both, not
    // neither), and must reference a real account.
    const accountIds = new Set(dto.lines.map((l) => l.accountId));
    const accounts = await this.accountRepo.findBy({ id: In([...accountIds]) });
    if (accounts.length !== accountIds.size) {
      throw new BadRequestException('One or more lines reference an account that does not exist');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of dto.lines) {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      if (debit > 0 && credit > 0) {
        throw new BadRequestException('Each line must have either a debit or a credit amount, not both');
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException('Each line must have a non-zero debit or credit amount');
      }
      totalDebit += debit;
      totalCredit += credit;
    }

    // Round to 3dp before comparing to avoid floating-point false positives.
    const roundedDebit = Math.round(totalDebit * 1000) / 1000;
    const roundedCredit = Math.round(totalCredit * 1000) / 1000;
    if (roundedDebit !== roundedCredit) {
      throw new BadRequestException(
        `Entry is not balanced — total debit (${roundedDebit.toFixed(3)}) must equal total credit (${roundedCredit.toFixed(3)})`,
      );
    }

    const entry = this.repo.create({
      entryNumber: this.generateEntryNumber(),
      date: dto.date || new Date().toISOString().slice(0, 10),
      reference: dto.reference,
      memo: dto.memo,
      createdByUserId: createdBy.userId,
      createdByEmail: createdBy.email,
      lines: dto.lines.map((l) =>
        this.lineRepo.create({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description,
        }),
      ),
    });
    const saved = await this.repo.save(entry);
    await this.activityLog.log({
      action: 'journal_entry.created',
      entityType: 'journal_entry',
      entityId: saved.id,
      userId: createdBy.userId,
      userEmail: createdBy.email,
      details: { entryNumber: saved.entryNumber, memo: saved.memo, totalDebit: roundedDebit },
    });
    return saved;
  }

  // Journal entries are kept for the audit trail like most financial
  // records in this system — deletion is allowed (no downstream module
  // references a JournalEntry yet) but logged, mirroring Reimbursement.
  async remove(id: string, actor: ActorRef) {
    const item = await this.findOne(id);
    await this.journalPosting.assertDateOpen(item.date, 'This journal entry');
    if (item.autoPosted) {
      throw new BadRequestException(
        'This entry was posted automatically from another record (Expense, Invoice, Reimbursement, Fund Transfer, or Tax Payment) — edit or delete that record instead of this entry directly.',
      );
    }
    // lines removed explicitly (not left to the DB cascade) so they are
    // kept with the delete record and come back on "Undo"
    if (item.lines?.length) await this.lineRepo.remove(item.lines);
    item.lines = [];
    await this.repo.remove(item);
    await this.activityLog.log({
      action: 'journal_entry.deleted',
      entityType: 'journal_entry',
      entityId: id,
      userId: actor.userId,
      userEmail: actor.email,
      details: { entryNumber: item.entryNumber, memo: item.memo },
    });
    return { deleted: true };
  }

  // Trial Balance — every active account's total debit/credit across all
  // journal entries, plus its net balance on its natural side. Only
  // accounts with at least one posted line are included (so a freshly
  // seeded, never-used Chart of Accounts doesn't clutter the report).
  async getTrialBalance() {
    const lines = await this.lineRepo.find();
    const accounts = await this.accountRepo.find({ order: { code: 'ASC' } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const totals = new Map<string, { debit: number; credit: number }>();
    for (const line of lines) {
      const entry = totals.get(line.accountId) || { debit: 0, credit: 0 };
      entry.debit += Number(line.debit);
      entry.credit += Number(line.credit);
      totals.set(line.accountId, entry);
    }

    const rows = [...totals.entries()]
      .map(([accountId, t]) => {
        const account = accountById.get(accountId);
        return {
          accountId,
          code: account?.code || '—',
          name: account?.name || 'Unknown account',
          type: account?.type,
          debit: this.round3(t.debit),
          credit: this.round3(t.credit),
          balance: this.round3(t.debit - t.credit),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = this.round3(rows.reduce((sum, r) => sum + r.debit, 0));
    const totalCredit = this.round3(rows.reduce((sum, r) => sum + r.credit, 0));

    return {
      rows,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
    };
  }

  // Income Statement (Profit & Loss) for a date range — Revenue and
  // Expense accounts only, summed from every Journal Entry line (manual +
  // auto-posted) whose parent entry's date falls in range.
  async getIncomeStatement(startDate: string, endDate: string) {
    const entries = await this.repo.find({ where: { date: Between(startDate, endDate) }, relations: ['lines'] });
    const accounts = await this.accountRepo.find();
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const revenueTotals = new Map<string, number>();
    const expenseTotals = new Map<string, number>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        const account = accountById.get(line.accountId);
        if (!account) continue;
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        if (account.type === AccountType.REVENUE) {
          revenueTotals.set(account.id, (revenueTotals.get(account.id) || 0) + (credit - debit));
        } else if (account.type === AccountType.EXPENSE) {
          expenseTotals.set(account.id, (expenseTotals.get(account.id) || 0) + (debit - credit));
        }
      }
    }

    const toRows = (totals: Map<string, number>) =>
      [...totals.entries()]
        .map(([accountId, amount]) => {
          const a = accountById.get(accountId)!;
          return { accountId, code: a.code, name: a.name, amount: this.round3(amount) };
        })
        .sort((x, y) => x.code.localeCompare(y.code));

    const revenues = toRows(revenueTotals);
    const expenses = toRows(expenseTotals);
    const totalRevenue = this.round3(revenues.reduce((s, r) => s + r.amount, 0));
    const totalExpense = this.round3(expenses.reduce((s, r) => s + r.amount, 0));
    return {
      period: { startDate, endDate },
      revenues,
      totalRevenue,
      expenses,
      totalExpense,
      netProfit: this.round3(totalRevenue - totalExpense),
    };
  }

  // Balance Sheet as of a given date — Asset/Liability/Equity accounts,
  // cumulative from every entry up to and including asOfDate. This system
  // has no periodic closing entries (Revenue/Expense accounts just keep
  // accumulating), so accumulated Net Income since inception is computed
  // here and folded into Equity as a "Retained Earnings" line — that's
  // what makes Assets = Liabilities + Equity balance without a manual
  // year-end closing step.
  async getBalanceSheet(asOfDate: string) {
    const entries = await this.repo.find({ where: { date: LessThanOrEqual(asOfDate) }, relations: ['lines'] });
    const accounts = await this.accountRepo.find();
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const assetTotals = new Map<string, number>();
    const liabilityTotals = new Map<string, number>();
    const equityTotals = new Map<string, number>();
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const entry of entries) {
      for (const line of entry.lines) {
        const account = accountById.get(line.accountId);
        if (!account) continue;
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        if (account.type === AccountType.ASSET) {
          assetTotals.set(account.id, (assetTotals.get(account.id) || 0) + (debit - credit));
        } else if (account.type === AccountType.LIABILITY) {
          liabilityTotals.set(account.id, (liabilityTotals.get(account.id) || 0) + (credit - debit));
        } else if (account.type === AccountType.EQUITY) {
          equityTotals.set(account.id, (equityTotals.get(account.id) || 0) + (credit - debit));
        } else if (account.type === AccountType.REVENUE) {
          totalRevenue += credit - debit;
        } else if (account.type === AccountType.EXPENSE) {
          totalExpense += debit - credit;
        }
      }
    }

    const toRows = (totals: Map<string, number>) =>
      [...totals.entries()]
        .map(([accountId, amount]) => {
          const a = accountById.get(accountId)!;
          return { accountId, code: a.code, name: a.name, amount: this.round3(amount) };
        })
        .sort((x, y) => x.code.localeCompare(y.code));

    const assets = toRows(assetTotals);
    const liabilities = toRows(liabilityTotals);
    const equity = toRows(equityTotals);
    const retainedEarnings = this.round3(totalRevenue - totalExpense);

    const totalAssets = this.round3(assets.reduce((s, r) => s + r.amount, 0));
    const totalLiabilities = this.round3(liabilities.reduce((s, r) => s + r.amount, 0));
    const totalEquity = this.round3(equity.reduce((s, r) => s + r.amount, 0) + retainedEarnings);
    const totalLiabilitiesAndEquity = this.round3(totalLiabilities + totalEquity);

    return {
      asOfDate,
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equity,
      retainedEarnings,
      totalEquity,
      totalLiabilitiesAndEquity,
      balanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.001,
    };
  }

  // Ledger Report — every line posted to one account, in date order, with
  // a running balance. If startDate is given, everything before it is
  // folded into an "opening balance" instead of being dropped, so the
  // running balance still reflects the account's true position rather
  // than restarting from zero.
  async getLedgerForAccount(accountId: string, startDate?: string, endDate?: string) {
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const entries = await this.repo.find({ relations: ['lines'], order: { date: 'ASC', createdAt: 'ASC' } });

    let openingBalance = 0;
    let runningBalance = 0;
    const rows: { date: string; createdAt: Date; entryNumber: string; memo: string; debit: number; credit: number; balance: number }[] = [];

    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        const delta = debit - credit;
        if (startDate && entry.date < startDate) {
          openingBalance += delta;
          continue;
        }
        if (endDate && entry.date > endDate) continue;
        runningBalance += delta;
        rows.push({
          date: entry.date,
          createdAt: entry.createdAt,
          entryNumber: entry.entryNumber,
          memo: line.description || entry.memo,
          debit,
          credit,
          balance: this.round3(openingBalance + runningBalance),
        });
      }
    }

    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      openingBalance: this.round3(openingBalance),
      rows,
      closingBalance: rows.length > 0 ? rows[rows.length - 1].balance : this.round3(openingBalance),
    };
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }
}
