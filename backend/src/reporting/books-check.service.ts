import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportingService } from './reporting.service';
import { JournalGapsService } from './journal-gaps.service';
import { omanToday } from '../common/oman-date';

export interface BooksCheck {
  key: string;
  title: string;
  ledgerLabel: string;
  ledger: number;
  recordsLabel: string;
  records: number;
  difference: number;
  ok: boolean;
  explain: string;
}

const TOLERANCE = 0.0015; // rounding of 3-decimal amounts

// Books Health Check (Reports): every control account in the ledger must
// equal the records it summarises. A difference means an entry reached
// one side but not the other (or went to the wrong account).
@Injectable()
export class BooksCheckService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private reporting: ReportingService,
    private journalGaps: JournalGapsService,
  ) {}

  private r3(n: number) {
    return Math.round(Number(n || 0) * 1000) / 1000;
  }

  // debit - credit of one account (all dates), optionally without some sources
  private async balance(code: string, excludeSources: string[] = []): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)', 'bal')
      .from('journal_entry_lines', 'l')
      .innerJoin('accounts', 'a', 'a.id = l.accountId')
      .innerJoin('journal_entries', 'e', 'e.id = l.journalEntryId')
      .where('a.code = :code', { code });
    if (excludeSources.length) qb.andWhere('(e.sourceType IS NULL OR e.sourceType NOT IN (:...ex))', { ex: excludeSources });
    const row = await qb.getRawOne();
    return this.r3(Number(row?.bal || 0));
  }

  private async scalar(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await this.dataSource.query(sql, params);
    const v = rows?.[0] ? Object.values(rows[0])[0] : 0;
    return this.r3(Number(v || 0));
  }

  private make(key: string, title: string, ledgerLabel: string, ledger: number, recordsLabel: string, records: number, explain: string): BooksCheck {
    const difference = this.r3(ledger - records);
    return { key, title, ledgerLabel, ledger, recordsLabel, records, difference, ok: Math.abs(difference) < TOLERANCE, explain };
  }

  async run() {
    const checks: BooksCheck[] = [];

    // 1. every entry balanced
    const tb = await this.dataSource.query('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM journal_entry_lines');
    checks.push(
      this.make('trial_balance', 'Trial balance', 'Total debits', this.r3(tb[0].d), 'Total credits', this.r3(tb[0].c), 'Every journal entry must have equal debits and credits.'),
    );

    // 2. customers
    checks.push(
      this.make(
        'receivables',
        'Accounts Receivable (1100)',
        'Ledger 1100',
        await this.balance('1100'),
        'Unpaid invoices',
        await this.scalar('SELECT COALESCE(SUM(total - paidAmount),0) FROM invoices'),
        'What customers owe in the books = the unpaid part of all invoices (incl. opening balances).',
      ),
    );

    // 3. suppliers: bills not yet paid, less supplier credits not yet used
    const bills = await this.scalar("SELECT COALESCE(SUM(receivedTotal - COALESCE(paidAmount,0)),0) FROM purchase_orders WHERE status <> 'cancelled'");
    const unusedCredits = await this.scalar('SELECT COALESCE(SUM(amount - appliedAmount - refundedAmount),0) FROM vendor_credits');
    checks.push(
      this.make(
        'payables',
        'Accounts Payable (2000)',
        'Ledger 2000',
        -(await this.balance('2000')),
        'Unpaid bills - unused vendor credits',
        this.r3(bills - unusedCredits),
        'What is owed to suppliers in the books = the unpaid part of received goods, opening and fixed-asset bills, less vendor credits not yet used.',
      ),
    );

    // 4/5. stock at cost
    checks.push(
      this.make(
        'raw_materials',
        'Raw material stock (1200)',
        'Ledger 1200',
        await this.balance('1200'),
        'Stock x cost',
        await this.scalar('SELECT COALESCE(SUM(quantityInStock * costPerUnit),0) FROM raw_materials'),
        'Raw material stock in the books = quantity on hand x weighted-average cost.',
      ),
    );
    checks.push(
      this.make(
        'finished_goods',
        'Finished goods stock (1210)',
        'Ledger 1210',
        await this.balance('1210'),
        'Stock x cost',
        await this.scalar('SELECT COALESCE(SUM(quantityInStock * costPerUnit),0) FROM finished_goods'),
        'Finished goods in the books = quantity on hand x weighted-average cost.',
      ),
    );

    // 6. each bank / cash account
    const banks: { name: string; currentBalance: string; code: string | null }[] = await this.dataSource.query(
      'SELECT b.name, b.currentBalance, a.code FROM bank_accounts b LEFT JOIN accounts a ON a.id = b.journalAccountId ORDER BY b.name',
    );
    for (const b of banks) {
      checks.push(
        this.make(
          `bank:${b.name}`,
          `Bank / cash: ${b.name}${b.code ? ` (${b.code})` : ''}`,
          b.code ? `Ledger ${b.code}` : 'Ledger (not linked)',
          b.code ? await this.balance(b.code) : 0,
          'Account balance',
          this.r3(Number(b.currentBalance)),
          'The balance shown on the bank/cash account = its ledger account.',
        ),
      );
    }

    // 7. VAT: net VAT owed in the books = VAT on the reports - VAT paid
    // formatted in SQL - a raw DATE comes back as a JS Date (timezone-shifted)
    const s = (await this.dataSource.query("SELECT DATE_FORMAT(openingBalanceDate, '%Y-%m-%d') AS d FROM settings WHERE id = 1"))?.[0];
    const from = s?.d ? this.nextDay(String(s.d)) : '2000-01-01';
    const to = omanToday();
    const v = await this.reporting.getVatSummary(from, to);
    const vatPaid = await this.scalar(
      "SELECT COALESCE(SUM(l.debit),0) FROM journal_entry_lines l JOIN accounts a ON a.id = l.accountId JOIN journal_entries e ON e.id = l.journalEntryId WHERE a.code = '2100' AND e.sourceType = 'tax_payment'",
    );
    const ledgerNet = this.r3(-(await this.balance('2100', ['opening_balance'])) - (await this.balance('1400', ['opening_balance'])));
    checks.push(
      this.make(
        'vat',
        'VAT (2100 output - 1400 input)',
        'Net VAT in the ledger',
        ledgerNet,
        'VAT reports - VAT paid',
        this.r3(Number(v.netVatPayable) - vatPaid),
        `Net VAT owed in the books (without opening balances) = output VAT - input VAT on the VAT reports from ${from}, less VAT paid with Tax Payments.`,
      ),
    );

    // Every document that should be in the books has its journal entry
    // (a posting that failed after the document was saved shows up here).
    const missingJournals = await this.journalGaps.findMissing();
    checks.push(
      this.make(
        'missing_journals',
        'Every document is in the books',
        'Documents without a journal entry',
        missingJournals.length,
        'Expected',
        0,
        'Invoices, payments, expenses, goods receipts and returns must each have their journal entry. Listed below with a Re-post button.',
      ),
    );

    return { checkedAt: new Date().toISOString(), ok: checks.every((c) => c.ok), checks, missingJournals };
  }

  private nextDay(d: string) {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  }
}
