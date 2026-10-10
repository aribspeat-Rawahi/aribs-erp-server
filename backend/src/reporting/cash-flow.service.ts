import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type CashFlowSection = 'operating' | 'investing' | 'financing';

interface Row {
  entryId: string;
  sourceType: string | null;
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

const OPENING_SOURCES = ['opening_balance', 'bank_opening'];
const FINANCING_LIABILITY_CODES = new Set(['2400', '2500', '2510']);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Statement of Cash Flows (direct method, IAS 7): every journal entry that
// moves money in a bank or cash account, split by the OTHER side of the
// entry - what the money was for. Each non-cash line's (credit - debit) is
// exactly the cash it brought in (+) or paid out (-), because entries
// balance. Classified by that account:
// - Investing: long-term assets (codes 1500 and above, e.g. machinery,
//   vehicles, construction, accumulated depreciation)
// - Financing: loans (2400, 2500, 2510 or any liability named "loan") and
//   equity (capital, drawings, dividends)
// - Operating: everything else (sales, expenses, VAT, salaries, stock,
//   receivables/payables, taxes)
// Moves between two of the company's own accounts cancel out. Opening
// balances are the starting cash, not a flow.
@Injectable()
export class CashFlowService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  private async cashAccountIds(): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT a.id FROM accounts a
         LEFT JOIN bank_accounts b ON b.journalAccountId = a.id
        WHERE b.id IS NOT NULL OR (a.type = 'asset' AND a.code REGEXP '^10[0-9][0-9]$')`,
    );
    return rows.map((r) => r.id);
  }

  classify(code: string, name: string, type: string): CashFlowSection {
    const n = /^\d+$/.test(code) ? Number(code) : NaN;
    if (type === 'equity') return 'financing';
    if (type === 'liability' && (FINANCING_LIABILITY_CODES.has(code) || /loan|financ|lease/i.test(name))) return 'financing';
    if (type === 'asset' && n >= 1500) return 'investing';
    return 'operating';
  }

  async build(startDate: string, endDate: string) {
    if (!isDate(startDate) || !isDate(endDate)) throw new BadRequestException('Give startDate and endDate as YYYY-MM-DD.');
    if (startDate > endDate) throw new BadRequestException('The start date is after the end date.');
    const cashIds = await this.cashAccountIds();
    const empty = { operating: [] as unknown[], investing: [] as unknown[], financing: [] as unknown[] };
    if (!cashIds.length) {
      return { startDate, endDate, openingCash: 0, closingCash: 0, netChange: 0, sections: empty, totals: { operating: 0, investing: 0, financing: 0 }, checks: { ledgerClosingCash: 0, matches: true } };
    }

    const balanceOf = async (where: string, params: unknown[]) => {
      const [row] = await this.dataSource.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal
           FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journalEntryId
          WHERE l.accountId IN (?) AND ${where}`,
        [cashIds, ...params],
      );
      return r3(Number(row?.bal || 0));
    };
    // starting cash: everything before the period, plus opening balances
    // dated inside it (they are a starting point, not money moving)
    const openingCash = await balanceOf(`(e.date < ? OR (e.sourceType IN (?) AND e.date <= ?))`, [startDate, OPENING_SOURCES, endDate]);
    const ledgerClosingCash = await balanceOf('e.date <= ?', [endDate]);

    const rows: Row[] = await this.dataSource.query(
      `SELECT e.id AS entryId, e.sourceType, l.accountId, a.code, a.name, a.type, l.debit, l.credit
         FROM journal_entries e
         JOIN journal_entry_lines l ON l.journalEntryId = e.id
         JOIN accounts a ON a.id = l.accountId
        WHERE e.date BETWEEN ? AND ?
          AND (e.sourceType IS NULL OR e.sourceType NOT IN (?))
          AND e.id IN (SELECT DISTINCT l2.journalEntryId FROM journal_entry_lines l2 WHERE l2.accountId IN (?))`,
      [startDate, endDate, OPENING_SOURCES, cashIds],
    );

    const cash = new Set(cashIds);
    const byAccount = new Map<string, { section: CashFlowSection; accountId: string; code: string; name: string; inflow: number; outflow: number }>();
    for (const r of rows) {
      if (cash.has(r.accountId)) continue;
      const amount = r3(Number(r.credit || 0) - Number(r.debit || 0)); // + money in, - money out
      if (!amount) continue;
      const key = r.accountId;
      const cur = byAccount.get(key) || { section: this.classify(r.code, r.name, r.type), accountId: r.accountId, code: r.code, name: r.name, inflow: 0, outflow: 0 };
      if (amount > 0) cur.inflow = r3(cur.inflow + amount);
      else cur.outflow = r3(cur.outflow - amount);
      byAccount.set(key, cur);
    }

    const sections: Record<CashFlowSection, { accountId: string; code: string; name: string; inflow: number; outflow: number; net: number }[]> = {
      operating: [],
      investing: [],
      financing: [],
    };
    for (const a of byAccount.values()) {
      sections[a.section].push({ accountId: a.accountId, code: a.code, name: a.name, inflow: a.inflow, outflow: a.outflow, net: r3(a.inflow - a.outflow) });
    }
    for (const s of Object.values(sections)) s.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
    const total = (s: CashFlowSection) => r3(sections[s].reduce((t, a) => t + a.net, 0));
    const totals = { operating: total('operating'), investing: total('investing'), financing: total('financing') };
    const netChange = r3(totals.operating + totals.investing + totals.financing);
    const closingCash = r3(openingCash + netChange);
    return {
      startDate,
      endDate,
      openingCash,
      netChange,
      closingCash,
      sections,
      totals,
      checks: { ledgerClosingCash, matches: Math.abs(closingCash - ledgerClosingCash) < 0.0005 },
    };
  }
}
