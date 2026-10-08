import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EmployeeService } from '../hr/employee.service';
import { SettingsService } from '../settings/settings.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { JournalEntryService } from '../journal/journal-entry.service';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Chart-of-Accounts codes — see journal/account.service.ts's
// DEFAULT_ACCOUNTS for where these were added.
const EOSB_EXPENSE_CODE = '717';
const EOSB_PAYABLE_CODE = '2150';
const INCOME_TAX_EXPENSE_CODE = '710';
const INCOME_TAX_PAYABLE_CODE = '2160';

// End-of-service gratuity, Oman (expatriate staff - Omani staff are covered
// by the Social Protection Fund instead), on the last BASIC wage:
//  - service up to 30 Jul 2023 (old Labour Law RD 35/2003): 15 days' wage a
//    year for the first 3 years, then 30 days' wage a year
//  - service from 31 Jul 2023 (Labour Law RD 53/2023, Art. 61): one basic
//    monthly wage a year
// It stops accruing when the expatriate savings scheme starts (Settings).
const NEW_LABOUR_LAW_FROM = '2023-07-31';
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365.25;

const ymdUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const yearsBetween = (a: string, b: string) => Math.max(0, (ymdUtc(b) - ymdUtc(a)) / 86400000 / DAYS_PER_YEAR);
const minDate = (...ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort()[0];
const maxDate = (...ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort().slice(-1)[0];

// Accrues two statutory provisions this system had a Chart-of-Accounts
// line for but no automated posting: End of Service Benefits (Gratuity)
// and corporate Income Tax. EOSB posts the monthly change (one entry per
// employee per month, replaced if the month is re-run); income tax
// replaces one year-to-date entry per year.
@Injectable()
export class AccrualPostingService {
  private readonly logger = new Logger(AccrualPostingService.name);

  constructor(
    private employeeService: EmployeeService,
    private settingsService: SettingsService,
    private journalPosting: JournalPostingService,
    private journalEntryService: JournalEntryService,
    private config: ConfigService,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // Gratuity earned up to `asOf` (YYYY-MM-DD) by one expatriate employee.
  computeEosbLiability(
    employee: { baseSalary?: number | string | null; joinedDate?: string | null; leftDate?: string | null; socialProtectionCovered?: boolean },
    asOf: string,
    savingsSchemeStart?: string | null,
  ): number {
    if (employee.socialProtectionCovered) return 0;
    const basic = Number(employee.baseSalary || 0);
    const joined = employee.joinedDate ? String(employee.joinedDate).slice(0, 10) : '';
    if (!(basic > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(joined)) return 0;
    const end = minDate(asOf, employee.leftDate ? String(employee.leftDate).slice(0, 10) : null, savingsSchemeStart || null)!;
    if (joined >= end) return 0;
    const daily = basic / DAYS_PER_MONTH;

    const oldEnd = minDate(end, NEW_LABOUR_LAW_FROM)!;
    const oldYears = joined < oldEnd ? yearsBetween(joined, oldEnd) : 0;
    const oldPart = Math.min(oldYears, 3) * 15 * daily + Math.max(oldYears - 3, 0) * 30 * daily;

    const newStart = maxDate(joined, NEW_LABOUR_LAW_FROM)!;
    const newYears = newStart < end ? yearsBetween(newStart, end) : 0;
    const newPart = newYears * basic;
    return this.round3(oldPart + newPart);
  }

  // What is already booked for this employee (all their EOSB entries except
  // `exceptSourceId`), from the ledger.
  private async eosbPosted(employeeId: string, exceptSourceId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS n
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journalEntryId
         JOIN accounts a ON a.id = l.accountId
        WHERE a.code = ? AND e.sourceType = 'eosb_accrual'
          AND (e.sourceId = ? OR e.sourceId LIKE ?) AND e.sourceId <> ?`,
      [EOSB_PAYABLE_CODE, employeeId, `${employeeId}:%`, exceptSourceId],
    );
    return this.round3(Number(rows?.[0]?.n || 0));
  }

  // Books only the CHANGE in the gratuity owed since the last posting, as
  // one entry per employee per month (dated `asOf`). Re-running the same
  // month replaces that month's entry; earlier months - even in closed
  // VAT periods - are never touched. A lower salary gives a reversal.
  async postEosbFor(
    employee: { id: string; baseSalary?: number | string | null; joinedDate?: string | null; leftDate?: string | null; socialProtectionCovered?: boolean; name?: string },
    actor: ActorRef,
    asOf: string = omanToday(),
    savingsSchemeStart?: string | null,
  ) {
    const sourceId = `${employee.id}:${asOf.slice(0, 7)}`;
    const target = this.computeEosbLiability(employee, asOf, savingsSchemeStart);
    const change = this.round3(target - (await this.eosbPosted(employee.id, sourceId)));
    try {
      if (Math.abs(change) < 0.0005) {
        await this.journalPosting.postForSource('eosb_accrual', sourceId, asOf, '', [], actor);
        return 0;
      }
      const expenseAccountId = await this.journalPosting.findAccountIdByCode(EOSB_EXPENSE_CODE);
      const payableAccountId = await this.journalPosting.findAccountIdByCode(EOSB_PAYABLE_CODE);
      const amount = Math.abs(change);
      const up = change > 0;
      await this.journalPosting.postForSource(
        'eosb_accrual',
        sourceId,
        asOf,
        `End of service gratuity ${asOf.slice(0, 7)} - ${employee.name || employee.id} (owed ${target.toFixed(3)})`,
        up
          ? [
              { accountId: expenseAccountId, debit: amount, description: 'End of service gratuity' },
              { accountId: payableAccountId, credit: amount, description: 'End of service gratuity' },
            ]
          : [
              { accountId: payableAccountId, debit: amount, description: 'End of service gratuity (decrease)' },
              { accountId: expenseAccountId, credit: amount, description: 'End of service gratuity (decrease)' },
            ],
        actor,
      );
    } catch (err) {
      console.error(`Auto-posting failed for eosb_accrual ${sourceId}:`, err);
    }
    return change;
  }

  // Recomputes and re-posts (or clears) the Income Tax provision for the
  // current fiscal year (assumed calendar-year, Jan 1 – Dec 31, since
  // Settings has no separate fiscal-year-start field yet) — one Journal
  // Entry per year (sourceId keyed by year), replaced with the latest
  // year-to-date total each run. No provision (and any existing entry is
  // cleared) if YTD net profit is zero or negative.
  async postIncomeTaxProvision(actor: ActorRef) {
    const settings = await this.settingsService.get();
    const rate = Number(settings.incomeTaxRatePercent) / 100;
    const endDate = omanToday();
    const year = Number(endDate.slice(0, 4));
    const startDate = `${year}-01-01`;

    const { netProfit } = await this.journalEntryService.getIncomeStatement(startDate, endDate);
    const provision = this.round3(Math.max(0, netProfit) * rate);
    const sourceId = `income-tax-${year}`;

    try {
      if (provision <= 0) {
        await this.journalPosting.postForSource('income_tax_provision', sourceId, endDate, '', [], actor);
        return 0;
      }
      const expenseAccountId = await this.journalPosting.findAccountIdByCode(INCOME_TAX_EXPENSE_CODE);
      const payableAccountId = await this.journalPosting.findAccountIdByCode(INCOME_TAX_PAYABLE_CODE);
      await this.journalPosting.postForSource(
        'income_tax_provision',
        sourceId,
        endDate,
        `Income tax provision ${year} (${settings.incomeTaxRatePercent}% of YTD net profit)`,
        [
          { accountId: expenseAccountId, debit: provision, description: `Income tax provision — ${year} year-to-date` },
          { accountId: payableAccountId, credit: provision, description: `Income tax provision — ${year} year-to-date` },
        ],
        actor,
      );
    } catch (err) {
      console.error(`Auto-posting failed for income_tax_provision ${sourceId}:`, err);
    }
    return provision;
  }

  // Runs at 07:15 on the 1st of every month — after Fixed Asset
  // depreciation (07:00, so this month's depreciation expense is already
  // posted) and before the Income Tax provision run below (which needs
  // this month's EOSB expense counted in net profit) and Payment
  // Reminders (08:00).
  @Cron('15 7 1 * *')
  async runMonthlyEosbAccrualCron() {
    // the 1st of the month books the month just ended, dated its last day
    const today = omanToday();
    const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 0));
    await this.runMonthlyEosbAccrual({}, d.toISOString().slice(0, 10));
  }

  async runMonthlyEosbAccrual(actor: ActorRef = {}, asOf: string = omanToday()) {
    if (String(this.config.get('ACCRUAL_POSTING_ENABLED')).toLowerCase() === 'false') return;
    const settings = await this.settingsService.get();
    const employees = await this.employeeService.findAll();
    let posted = 0;
    for (const employee of employees) {
      // everyone with a join date: leavers are computed up to their last day
      // (their change is then 0), Social Protection staff get nothing
      if (employee.socialProtectionCovered || !employee.joinedDate) continue;
      try {
        const change = await this.postEosbFor(employee, actor, asOf, settings.expatSavingsSchemeStart);
        if (change !== 0) posted++;
      } catch (err) {
        this.logger.error(`EOSB accrual failed for employee ${employee.id}:`, err as Error);
      }
    }
    this.logger.log(`EOSB accrual as of ${asOf}: ${posted} of ${employees.length} employee(s) changed.`);
  }

  // Runs at 07:30 on the 1st of every month.
  @Cron('30 7 1 * *')
  async runMonthlyIncomeTaxProvision() {
    if (String(this.config.get('ACCRUAL_POSTING_ENABLED')).toLowerCase() === 'false') return;
    try {
      const provision = await this.postIncomeTaxProvision({});
      this.logger.log(`Monthly income tax provision run: ${provision} OMR posted for year-to-date.`);
    } catch (err) {
      this.logger.error('Monthly income tax provision failed:', err as Error);
    }
  }
}
