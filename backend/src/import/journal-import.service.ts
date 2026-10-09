import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { ImportService, UploadedSheet } from './import.service';
import { JournalImportBatch, JournalImportMapping } from './journal-import.entity';
import { Account } from '../journal/account.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { JournalEntryLine } from '../journal/journal-entry-line.entity';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { Settings } from '../settings/settings.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { omanToday } from '../common/oman-date';

interface Actor {
  userId?: string;
  email?: string;
}

export const JOURNAL_IMPORT_SOURCE = 'journal_import';
const MAX_ROWS = 10000;
const MAX_BYTES = 10 * 1024 * 1024;

// Accounts kept by a module of their own (each has a list behind it that
// must agree with the ledger) - history for these goes in as opening
// balances or through the module, not as loose journal lines.
const BLOCKED_CODES: Record<string, string> = {
  '1100': 'Accounts Receivable - enter customer balances as opening balances / invoices',
  '2000': 'Accounts Payable - enter supplier balances as opening balances / purchase orders',
  '1200': 'Raw material stock - enter stock as opening balances / purchase orders',
  '1210': 'Finished goods stock - enter stock as opening balances / production',
  '1310': 'Vendor prepayments - use Suppliers > Vendor Prepayments',
};

type ColKey = 'date' | 'entryNo' | 'description' | 'account' | 'debit' | 'credit' | 'comments';
const HEADER_NAMES: Record<ColKey, string[]> = {
  date: ['date', 'entrydate', 'transactiondate', 'voucherdate'],
  entryNo: ['entryno', 'entry', 'entrynumber', 'voucher', 'voucherno', 'jvno', 'jv', 'ref', 'refno', 'reference'],
  description: ['description', 'narration', 'particulars', 'details', 'memo'],
  account: ['account', 'accounts', 'accountname', 'accountcode', 'ledger', 'head', 'accounthead'],
  debit: ['debit', 'dr', 'debitomr', 'debitamount'],
  credit: ['credit', 'cr', 'creditomr', 'creditamount'],
  comments: ['comments', 'comment', 'party', 'paidto', 'receivedfrom', 'supplier', 'note', 'notes', 'linedescription', 'remarks'],
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

interface Line {
  row: number;
  date: string;
  entryNo: string;
  description: string;
  accountText: string;
  comments: string;
  debit: number;
  credit: number;
  account?: Account;
}

interface Entry {
  rows: number[];
  date: string;
  entryNo: string;
  description: string;
  lines: Line[];
}

interface Parsed {
  fileName: string;
  rowCount: number;
  entries: Entry[];
  errors: { row: number; message: string }[];
  unknown: Map<string, { name: string; count: number; firstRow: number }>;
  used: Map<string, { name: string; account: Account; via: 'code' | 'name' | 'saved'; count: number }>;
  bankByGl: Map<string, BankAccount>;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

// Accounting > Journals > Import: post historical (or any) general journal
// entries from an Excel/CSV sheet - Date, Entry No, Description, Account,
// Debit, Credit, Comments. Nothing is saved until the whole file is clean:
// every entry balances, every account is known, every date is after the
// closed books and no bank/cash account would go below zero.
@Injectable()
export class JournalImportService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private sheets: ImportService,
    private journal: JournalPostingService,
    private activityLog: ActivityLogService,
  ) {}

  // ---------------------------------------------------------------- parsing

  private parseDate(raw: string): string | null {
    const t = raw.trim();
    if (!t) return null;
    let y: number, m: number, d: number;
    let mm: RegExpMatchArray | null;
    if ((mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+mm[1], +mm[2], +mm[3]];
    else if ((mm = t.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]+(\d{2,4})$/))) {
      const mon = MONTHS[mm[2].toLowerCase().slice(0, mm[2].toLowerCase().startsWith('sept') ? 4 : 3)];
      if (!mon) return null;
      [y, m, d] = [+mm[3] < 100 ? 2000 + +mm[3] : +mm[3], mon, +mm[1]];
    } else if ((mm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
      // day first (Oman)
      [y, m, d] = [+mm[3] < 100 ? 2000 + +mm[3] : +mm[3], +mm[2], +mm[1]];
    } else if (/^\d{5}(\.\d+)?$/.test(t)) {
      // Excel serial date
      const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    } else return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }

  private parseAmount(raw: string): number | null | 'bad' {
    const t = raw.trim().replace(/,/g, '').replace(/\s/g, '').replace(/^OMR/i, '');
    if (!t || t === '-') return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return 'bad';
    return r3(Number(t));
  }

  private async parse(file: UploadedSheet, manager: EntityManager = this.dataSource.manager): Promise<Parsed> {
    const grid = await this.sheets.readGrid(file, MAX_ROWS, MAX_BYTES);
    // header = first row (within the top 10) that has Date, Account and Debit
    let headerRow = -1;
    const cols: Partial<Record<ColKey, number>> = {};
    for (let r = 0; r < Math.min(grid.length, 10) && headerRow < 0; r++) {
      const keys = (grid[r] || []).map((c) => headerKey(c || ''));
      const find = (k: ColKey) => keys.findIndex((h) => HEADER_NAMES[k].includes(h));
      if (find('date') >= 0 && find('account') >= 0 && find('debit') >= 0 && find('credit') >= 0) {
        headerRow = r;
        (Object.keys(HEADER_NAMES) as ColKey[]).forEach((k) => {
          const i = find(k);
          if (i >= 0) cols[k] = i;
        });
      }
    }
    if (headerRow < 0) {
      throw new BadRequestException('Could not find the header row. The sheet needs the columns Date, Account, Debit and Credit (Entry No, Description and Comments are optional).');
    }

    const accounts = await manager.find(Account);
    const byCode = new Map(accounts.map((a) => [norm(a.code), a]));
    const byName = new Map(accounts.map((a) => [norm(a.name), a]));
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const saved = new Map((await manager.find(JournalImportMapping)).map((m) => [m.sourceName, byId.get(m.accountId)]));
    const banks = await manager.find(BankAccount);
    const bankByGl = new Map(banks.filter((b) => b.journalAccountId).map((b) => [b.journalAccountId as string, b]));

    const errors: { row: number; message: string }[] = [];
    const unknown = new Map<string, { name: string; count: number; firstRow: number }>();
    const used = new Map<string, { name: string; account: Account; via: 'code' | 'name' | 'saved'; count: number }>();
    const cell = (row: string[], k: ColKey) => (cols[k] === undefined ? '' : String(row[cols[k] as number] ?? '').trim());

    const lines: Line[] = [];
    let rowCount = 0;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!row.some((c) => String(c ?? '').trim())) continue;
      rowCount++;
      const n = r + 1; // row number as Excel shows it
      const rowErrors: string[] = [];
      const date = this.parseDate(cell(row, 'date'));
      if (!date) rowErrors.push(cell(row, 'date') ? `Date "${cell(row, 'date')}" is not a date (use e.g. 23-Jun-2024 or 2024-06-23).` : 'Date is missing.');
      const debit = this.parseAmount(cell(row, 'debit'));
      const credit = this.parseAmount(cell(row, 'credit'));
      if (debit === 'bad') rowErrors.push(`Debit "${cell(row, 'debit')}" is not a number.`);
      if (credit === 'bad') rowErrors.push(`Credit "${cell(row, 'credit')}" is not a number.`);
      const dr = typeof debit === 'number' ? debit : 0;
      const cr = typeof credit === 'number' ? credit : 0;
      if (debit !== 'bad' && credit !== 'bad') {
        if (dr > 0 && cr > 0) rowErrors.push('Put the amount in Debit OR Credit, not both.');
        if (!(dr > 0) && !(cr > 0)) rowErrors.push('No amount (Debit or Credit).');
      }
      const accountText = cell(row, 'account');
      let account: Account | undefined;
      if (!accountText) rowErrors.push('Account is missing.');
      else {
        const key = norm(accountText);
        let via: 'code' | 'name' | 'saved' | null = null;
        if (byCode.has(key)) [account, via] = [byCode.get(key), 'code'];
        else if (byName.has(key)) [account, via] = [byName.get(key), 'name'];
        else if (saved.get(key)) [account, via] = [saved.get(key), 'saved'];
        if (account && via) {
          if (BLOCKED_CODES[account.code]) rowErrors.push(`"${accountText}" is ${account.code} ${BLOCKED_CODES[account.code]}.`);
          else if (!account.active) rowErrors.push(`Account ${account.code} ${account.name} is switched off in the Chart of Accounts.`);
          const u = used.get(key) || { name: accountText, account, via, count: 0 };
          u.count++;
          used.set(key, u);
        } else {
          const u = unknown.get(key) || { name: accountText, count: 0, firstRow: n };
          u.count++;
          unknown.set(key, u);
        }
      }
      for (const m of rowErrors) errors.push({ row: n, message: m });
      lines.push({
        row: n,
        date: date || '',
        entryNo: cell(row, 'entryNo'),
        description: cell(row, 'description'),
        accountText,
        comments: cell(row, 'comments'),
        debit: dr,
        credit: cr,
        account,
      });
    }
    if (!rowCount) throw new BadRequestException('The sheet has no entries under the header row.');

    // group the lines into entries: same Entry No, or - without one - the
    // following rows until debits = credits
    const entries: Entry[] = [];
    const byNo = new Map<string, Entry>();
    let open: Entry | null = null;
    const sum = (e: Entry) => r3(e.lines.reduce((s, l) => s + l.debit - l.credit, 0));
    const closeOpen = () => {
      if (open && open.lines.length < 2) {
        errors.push({ row: open.rows[0], message: 'This row has no matching other side - an entry needs at least one debit row and one credit row.' });
      } else if (open && Math.abs(sum(open)) > 0.0005) {
        errors.push({ row: open.rows[0], message: `Rows ${open.rows[0]}-${open.rows[open.rows.length - 1]} do not balance (debits - credits = ${sum(open).toFixed(3)}).` });
      }
      open = null;
    };
    for (const l of lines) {
      if (l.entryNo) {
        closeOpen();
        let e = byNo.get(l.entryNo);
        if (!e) {
          e = { rows: [], date: l.date, entryNo: l.entryNo, description: l.description, lines: [] };
          byNo.set(l.entryNo, e);
          entries.push(e);
        }
        if (e.date !== l.date) errors.push({ row: l.row, message: `Entry ${l.entryNo} has more than one date.` });
        if (!e.description && l.description) e.description = l.description;
        e.rows.push(l.row);
        e.lines.push(l);
        continue;
      }
      if (open && open.date !== l.date) closeOpen();
      if (!open) {
        open = { rows: [], date: l.date, entryNo: '', description: l.description, lines: [] };
        entries.push(open);
      }
      if (!open.description && l.description) open.description = l.description;
      open.rows.push(l.row);
      open.lines.push(l);
      if (open.lines.length >= 2 && Math.abs(sum(open)) < 0.0005) open = null;
    }
    closeOpen();
    for (const e of byNo.values()) {
      if (e.lines.length < 2 || Math.abs(sum(e)) > 0.0005) {
        errors.push({ row: e.rows[0], message: `Entry ${e.entryNo} does not balance (debits - credits = ${sum(e).toFixed(3)}).` });
      }
    }

    // dates: after the closed books, and only once the opening balances are done
    const s = await manager.findOne(Settings, { where: { id: 1 } });
    const lock = await this.journal.lockInfo(manager);
    const today = omanToday();
    if (s?.openingBalanceDate && !s.openingBalanceFinalizedAt) {
      errors.push({ row: 0, message: `Finalize the opening balances (as of ${String(s.openingBalanceDate).slice(0, 10)}) before importing entries.` });
    }
    for (const e of entries) {
      if (!e.date) continue;
      if (lock && e.date <= lock.date) {
        errors.push({ row: e.rows[0], message: `Dated ${e.date}, but the books are closed up to ${lock.date} (${lock.reason}).` });
      } else if (e.date > today) errors.push({ row: e.rows[0], message: `Dated ${e.date}, which is in the future.` });
    }

    // bank / cash accounts may never go below zero (money in comes first
    // on the same day)
    const bankEntries = entries
      .filter((e) => e.date && e.lines.some((l) => l.account && bankByGl.has(l.account.id)))
      .map((e) => ({ e, inflow: e.lines.reduce((s, l) => s + (l.account && bankByGl.has(l.account.id) ? l.debit - l.credit : 0), 0) }))
      .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : b.inflow - a.inflow));
    const running = new Map(banks.map((b) => [b.id, r3(Number(b.currentBalance))]));
    const reported = new Set<string>();
    for (const { e } of bankEntries) {
      for (const l of e.lines) {
        const bank = l.account ? bankByGl.get(l.account.id) : undefined;
        if (!bank) continue;
        const next = r3((running.get(bank.id) || 0) + l.debit - l.credit);
        running.set(bank.id, next);
        if (next < -0.0005 && !reported.has(bank.id)) {
          reported.add(bank.id);
          errors.push({
            row: l.row,
            message: `${bank.name} would go below zero on ${e.date} (${next.toFixed(3)}). Add the money that came in before it (e.g. the loan received) or check the amounts.`,
          });
        }
      }
    }

    // the same file twice would double the books
    const datesSorted = entries.map((e) => e.date).filter(Boolean).sort();
    const totalDebit = r3(entries.reduce((t, e) => t + e.lines.reduce((u, l) => u + l.debit, 0), 0));
    if (datesSorted.length) {
      const [dup] = await manager.query(
        `SELECT fileName, DATE_FORMAT(createdAt, '%Y-%m-%d') AS d FROM journal_import_batches
          WHERE entryCount = ? AND ABS(totalDebit - ?) < 0.0005 AND firstDate = ? AND lastDate = ? LIMIT 1`,
        [entries.length, totalDebit, datesSorted[0], datesSorted[datesSorted.length - 1]],
      );
      if (dup) errors.push({ row: 0, message: `This file was already imported ("${dup.fileName}" on ${dup.d}) - same entries, dates and total. Undo that one first if it was wrong.` });
    }

    errors.sort((a, b) => a.row - b.row);
    return { fileName: file.originalname || 'import.xlsx', rowCount, entries, errors, unknown, used, bankByGl };
  }

  private suggest(name: string, accounts: Account[]) {
    const words = norm(name).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!words.length) return null;
    let best: Account | null = null;
    let bestScore = 0;
    for (const a of accounts) {
      if (!a.active || BLOCKED_CODES[a.code]) continue;
      const an = norm(a.name);
      const score = words.filter((w) => an.includes(w)).length / words.length;
      if (score > bestScore) [best, bestScore] = [a, score];
    }
    return best && bestScore >= 0.5 ? { id: best.id, code: best.code, name: best.name } : null;
  }

  // ---------------------------------------------------------------- API

  async preview(file: UploadedSheet) {
    const p = await this.parse(file);
    const accounts = await this.dataSource.manager.find(Account);
    const lineCount = p.entries.reduce((s, e) => s + e.lines.length, 0);
    const dates = p.entries.map((e) => e.date).filter(Boolean).sort();
    return {
      fileName: p.fileName,
      rowCount: p.rowCount,
      entryCount: p.entries.length,
      lineCount,
      totalDebit: r3(p.entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0)),
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      bankLineCount: p.entries.reduce((s, e) => s + e.lines.filter((l) => l.account && p.bankByGl.has(l.account.id)).length, 0),
      errors: p.errors.slice(0, 500),
      errorCount: p.errors.length,
      unknownAccounts: [...p.unknown.values()].map((u) => ({ ...u, suggestion: this.suggest(u.name, accounts) })),
      accountsUsed: [...p.used.values()]
        .map((u) => ({ name: u.name, via: u.via, count: u.count, accountId: u.account.id, code: u.account.code, accountName: u.account.name, bank: p.bankByGl.has(u.account.id) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      sample: p.entries.slice(0, 15).map((e) => ({
        date: e.date,
        entryNo: e.entryNo,
        description: e.description,
        lines: e.lines.map((l) => ({ account: l.account ? `${l.account.code} ${l.account.name}` : l.accountText, debit: l.debit, credit: l.credit, comments: l.comments })),
      })),
      ready: p.errors.length === 0 && p.unknown.size === 0,
    };
  }

  async saveMappings(mappings: { name: string; accountId: string }[]) {
    if (!Array.isArray(mappings) || !mappings.length) throw new BadRequestException('Nothing to save.');
    const accounts = await this.dataSource.manager.find(Account, { where: { id: In(mappings.map((m) => m.accountId)) } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const m of mappings) {
      const a = byId.get(m.accountId);
      if (!m.name?.trim() || !a) throw new BadRequestException('Pick an account for each name.');
      if (BLOCKED_CODES[a.code]) throw new BadRequestException(`${a.code} ${a.name} can't be used here: ${BLOCKED_CODES[a.code]}.`);
      if (!a.active) throw new BadRequestException(`${a.code} ${a.name} is switched off.`);
    }
    await this.dataSource.transaction(async (manager) => {
      for (const m of mappings) {
        const sourceName = norm(m.name).slice(0, 200);
        const existing = await manager.findOne(JournalImportMapping, { where: { sourceName } });
        if (existing) await manager.update(JournalImportMapping, { id: existing.id }, { accountId: m.accountId });
        else await manager.save(manager.create(JournalImportMapping, { sourceName, accountId: m.accountId }));
      }
    });
    return { saved: mappings.length };
  }

  async commit(file: UploadedSheet, actor: Actor) {
    const result = await this.dataSource.transaction(async (manager) => {
      // bank balances must not move under us while we post
      const banks = await manager.find(BankAccount, { lock: { mode: 'pessimistic_write' } });
      const p = await this.parse(file, manager);
      if (p.unknown.size) throw new BadRequestException(`${p.unknown.size} account name(s) are not matched yet - match them in the preview first.`);
      if (p.errors.length) throw new BadRequestException(`The file has ${p.errors.length} problem(s) - fix them and upload again. First: row ${p.errors[0].row}: ${p.errors[0].message}`);
      const bankById = new Map(banks.map((b) => [b.id, b]));

      const sorted = [...p.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rows[0] - b.rows[0]));
      const batch = await manager.save(
        manager.create(JournalImportBatch, {
          fileName: p.fileName.slice(0, 255),
          entryCount: sorted.length,
          lineCount: sorted.reduce((s, e) => s + e.lines.length, 0),
          totalDebit: r3(sorted.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0)),
          firstDate: sorted[0].date,
          lastDate: sorted[sorted.length - 1].date,
          bankTransactionIds: '[]',
          createdByEmail: actor.email || null,
        }),
      );
      const txnIds: string[] = [];
      let n = 0;
      for (const e of sorted) {
        n++;
        const memo = (e.description || 'Imported entry').slice(0, 250);
        const lines: PostingLine[] = e.lines.map((l) => ({
          accountId: (l.account as Account).id,
          debit: l.debit || undefined,
          credit: l.credit || undefined,
          description: (l.comments || l.description || memo).slice(0, 250),
        }));
        await this.journal.postForSource(JOURNAL_IMPORT_SOURCE, `${batch.id}:${n}`, e.date, memo, lines, actor, e.entryNo || undefined, manager);
        for (const l of e.lines) {
          const bank = p.bankByGl.get((l.account as Account).id);
          if (!bank) continue;
          const acc = bankById.get(bank.id) as BankAccount;
          const amount = l.debit || l.credit;
          const txn = await manager.save(
            manager.create(BankTransaction, {
              bankAccountId: acc.id,
              type: l.debit ? BankTransactionType.DEPOSIT : BankTransactionType.WITHDRAWAL,
              amount,
              date: e.date,
              note: `${memo}${l.comments ? ' - ' + l.comments : ''}`.slice(0, 250),
            }),
          );
          txnIds.push(txn.id);
          acc.currentBalance = r3(Number(acc.currentBalance) + (l.debit ? amount : -amount));
        }
      }
      for (const acc of bankById.values()) await manager.update(BankAccount, { id: acc.id }, { currentBalance: acc.currentBalance });
      batch.bankTransactionIds = JSON.stringify(txnIds);
      await manager.save(batch);
      return batch;
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'journal_import.created',
      entityType: 'journal_import',
      entityId: result.id,
      details: { fileName: result.fileName, entries: result.entryCount, totalDebit: result.totalDebit, from: result.firstDate, to: result.lastDate },
    });
    return this.describe(result);
  }

  private describe(b: JournalImportBatch) {
    return {
      id: b.id,
      fileName: b.fileName,
      entryCount: b.entryCount,
      lineCount: b.lineCount,
      totalDebit: Number(b.totalDebit),
      firstDate: String(b.firstDate).slice(0, 10),
      lastDate: String(b.lastDate).slice(0, 10),
      bankLineCount: (JSON.parse(b.bankTransactionIds || '[]') as string[]).length,
      createdByEmail: b.createdByEmail,
      createdAt: b.createdAt,
    };
  }

  async list() {
    const rows = await this.dataSource.manager.query(
      `SELECT id, fileName, entryCount, lineCount, totalDebit, DATE_FORMAT(firstDate, '%Y-%m-%d') AS firstDate,
              DATE_FORMAT(lastDate, '%Y-%m-%d') AS lastDate, bankTransactionIds, createdByEmail, createdAt
         FROM journal_import_batches ORDER BY createdAt DESC`,
    );
    return rows.map((b: JournalImportBatch) => this.describe(b));
  }

  async undo(id: string, actor: Actor) {
    const done = await this.dataSource.transaction(async (manager) => {
      const [b] = await manager.query(
        `SELECT id, fileName, entryCount, DATE_FORMAT(firstDate, '%Y-%m-%d') AS firstDate, bankTransactionIds FROM journal_import_batches WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!b) throw new NotFoundException('Import not found');
      const lock = await this.journal.lockInfo(manager);
      if (lock && b.firstDate <= lock.date) {
        throw new BadRequestException(`This file has entries dated ${b.firstDate}, but the books are closed up to ${lock.date} (${lock.reason}). It can't be undone.`);
      }
      const txnIds: string[] = JSON.parse(b.bankTransactionIds || '[]');
      const txns = txnIds.length ? await manager.find(BankTransaction, { where: { id: In(txnIds) } }) : [];
      if (txns.some((t) => t.reconciliationId)) {
        throw new BadRequestException('Some of its bank lines are in a completed bank reconciliation - undo that reconciliation first.');
      }
      const effect = new Map<string, number>();
      for (const t of txns) effect.set(t.bankAccountId, r3((effect.get(t.bankAccountId) || 0) + (t.type === BankTransactionType.DEPOSIT ? -Number(t.amount) : Number(t.amount))));
      if (effect.size) {
        const accs = await manager.find(BankAccount, { where: { id: In([...effect.keys()]) }, lock: { mode: 'pessimistic_write' } });
        for (const a of accs) {
          const next = r3(Number(a.currentBalance) + (effect.get(a.id) || 0));
          if (next < -0.0005) throw new BadRequestException(`Undoing would take ${a.name} below zero (${next.toFixed(3)}) - money from this file was spent by later entries.`);
          await manager.update(BankAccount, { id: a.id }, { currentBalance: next });
        }
      }
      if (txns.length) await manager.delete(BankTransaction, { id: In(txns.map((t) => t.id)) });
      const jes: { id: string }[] = await manager.query(`SELECT id FROM journal_entries WHERE sourceType = ? AND sourceId LIKE ?`, [JOURNAL_IMPORT_SOURCE, `${id}:%`]);
      if (jes.length) {
        const ids = jes.map((j) => j.id);
        await manager.delete(JournalEntryLine, { journalEntryId: In(ids) });
        await manager.delete(JournalEntry, { id: In(ids) });
      }
      await manager.query('DELETE FROM journal_import_batches WHERE id = ?', [id]);
      return { fileName: b.fileName as string, entries: jes.length };
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'journal_import.undone',
      entityType: 'journal_import',
      entityId: id,
      details: done,
    });
    return { undone: true, ...done };
  }

  // ---------------------------------------------------------------- template

  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Entry No', key: 'no', width: 10 },
      { header: 'Description', key: 'desc', width: 40 },
      { header: 'Account', key: 'acc', width: 32 },
      { header: 'Debit', key: 'dr', width: 14 },
      { header: 'Credit', key: 'cr', width: 14 },
      { header: 'Comments', key: 'cm', width: 36 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED7D31' } };
    const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
    const ex: [Date, string, string, string, number | null, number | null, string][] = [
      [d(2024, 6, 20), '1', 'Loan received - 1st tranche', 'Bank', 20000, null, 'Oman Development Bank'],
      [d(2024, 6, 20), '1', 'Loan received - 1st tranche', '2500', null, 20000, ''],
      [d(2024, 6, 23), '2', 'Life insurance policy', 'Insurance Expense', 4500, null, 'Dhofar Insurance Company'],
      [d(2024, 6, 23), '2', 'Life insurance policy', 'Bank', null, 4500, ''],
      [d(2024, 8, 1), '3', '1st payment for Boundary Wall & Electricity Room', 'Construction & Civil Works', 7000, null, 'Abu Abdullah Noman SPC'],
      [d(2024, 8, 1), '3', '1st payment for Boundary Wall & Electricity Room', 'Bank', null, 7000, ''],
    ];
    for (const [date, no, desc, acc, dr, cr, cm] of ex) ws.addRow({ date, no, desc, acc, dr, cr, cm });
    ws.getColumn('date').numFmt = 'dd-mmm-yyyy';
    ws.getColumn('dr').numFmt = '#,##0.000';
    ws.getColumn('cr').numFmt = '#,##0.000';
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const help = wb.addWorksheet('Help');
    help.columns = [{ header: 'How to fill the Data sheet', key: 'n', width: 120 }];
    help.getRow(1).font = { bold: true };
    [
      'One row = one debit or one credit line. Delete the example rows before importing.',
      'Date: a date cell, or text like 23-Jun-2024 / 2024-06-23 / 23/06/2024 (day first).',
      'Entry No: optional. Rows with the same Entry No are one journal entry. Without it, the next rows are one entry until Debit total = Credit total.',
      'Description: what the entry is (shown on the journal entry).',
      'Account: an account CODE (e.g. 2500) or NAME from the Accounts sheet - or your own name: the ERP asks once which account it is and remembers it.',
      'Debit / Credit: amount in OMR (up to 3 decimals) in ONE of the two columns.',
      'Comments: optional - party / supplier, shown on the line.',
      '"Bank" (or any bank/cash account) lines also appear in that account\'s transactions, so it must never go below zero: put the money coming in (loan, capital) before the payments.',
      'Not allowed here: 1100 Receivable, 2000 Payable, 1200/1210 Stock, 1310 Vendor prepayments - these have their own lists (opening balances, invoices, purchase orders).',
      'Dates must be after the opening balance date / last filed VAT return. Nothing is saved unless the whole file is correct. A whole file can be undone later.',
    ].forEach((n) => help.addRow({ n }));

    const accSheet = wb.addWorksheet('Accounts');
    accSheet.columns = [
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Name', key: 'name', width: 50 },
      { header: 'Type', key: 'type', width: 12 },
    ];
    accSheet.getRow(1).font = { bold: true };
    const accounts = await this.dataSource.manager.find(Account, { where: { active: true }, order: { code: 'ASC' } });
    for (const a of accounts) if (!BLOCKED_CODES[a.code]) accSheet.addRow({ code: a.code, name: a.name, type: a.type });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
