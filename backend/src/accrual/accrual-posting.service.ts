import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

// Standard Oman gratuity tiers: 15 days' basic salary per year of
// service for the first 3 years, 30 days' (1 month) basic salary per
// year after that (Oman Labour Law, Royal Decree 35/2003 Art. 60 and
// its amendments — the same tiered structure used across the GCC).
// Kept as constants rather than a Settings field since changing the
// legal formula itself is rare; the amounts it's applied to
// (baseSalary, joinedDate) already come from each Employee record.
const EOSB_DAYS_PER_YEAR_FIRST_3 = 15;
const EOSB_DAYS_PER_YEAR_AFTER_3 = 30;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365.25;

// Accrues two statutory provisions this system had a Chart-of-Accounts
// line for but no automated posting: End of Service Benefits (Gratuity)
// and corporate Income Tax — both regenerate-on-change every run
// (existing JournalPostingService.postForSource semantics: delete-then-
// recreate), so re-running the same month, or the cron firing twice, is
// safe and just replaces the entry with the same/updated total rather
// than double-accruing. Same reasoning as FixedAssetService's monthly
// depreciation, but simpler — no "already posted this period" guard is
// needed because these post the running TOTAL each time, not an
// incremental top-up.
@Injectable()
export class AccrualPostingService {
  private readonly logger = new Logger(AccrualPostingService.name);

  constructor(
    private employeeService: EmployeeService,
    private settingsService: SettingsService,
    private journalPosting: JournalPostingService,
    private journalEntryService: JournalEntryService,
    private config: ConfigService,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // Full end-of-service gratuity liability accrued to date for one
  // employee, under the standard Oman tiered formula. Returns 0 if the
  // record is missing what's needed to compute it (baseSalary/joinedDate).
  computeEosbLiability(employee: { baseSalary?: number | string | null; joinedDate?: string | null }, asOf = new Date()): number {
    if (!employee.baseSalary || !employee.joinedDate) return 0;
    const baseSalary = Number(employee.baseSalary);
    if (!(baseSalary > 0)) return 0;

    const joined = new Date(employee.joinedDate);
    if (Number.isNaN(joined.getTime())) return 0;
    const serviceYears = (asOf.getTime() - joined.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR);
    if (serviceYears <= 0) return 0;

    const dailyWage = baseSalary / DAYS_PER_MONTH;
    let gratuity: number;
    if (serviceYears <= 3) {
      gratuity = serviceYears * EOSB_DAYS_PER_YEAR_FIRST_3 * dailyWage;
    } else {
      const firstThree = 3 * EOSB_DAYS_PER_YEAR_FIRST_3 * dailyWage;
      const remainder = (serviceYears - 3) * EOSB_DAYS_PER_YEAR_AFTER_3 * dailyWage;
      gratuity = firstThree + remainder;
    }
    return this.round3(gratuity);
  }

  // Recomputes and re-posts (or clears) one employee's EOSB accrual —
  // shared by the monthly cron and the manual "recompute now" endpoint.
  // sourceId is per-employee so each has its own Journal Entry, easy to
  // trace/audit individually. A terminated/archived employee is simply
  // skipped by the caller — their last-posted balance is left exactly as
  // it was until an actual payout settles it (a separate future feature;
  // this is accrual only).
  async postEosbFor(employee: { id: string; baseSalary?: number | string | null; joinedDate?: string | null; name?: string }, actor: ActorRef) {
    const amount = this.computeEosbLiability(employee);
    try {
      if (amount <= 0) {
        await this.journalPosting.postForSource('eosb_accrual', employee.id, omanToday(), '', [], actor);
        return 0;
      }
      const expenseAccountId = await this.journalPosting.findAccountIdByCode(EOSB_EXPENSE_CODE);
      const payableAccountId = await this.journalPosting.findAccountIdByCode(EOSB_PAYABLE_CODE);
      await this.journalPosting.postForSource(
        'eosb_accrual',
        employee.id,
        omanToday(),
        `End of service benefits accrual — ${employee.name || employee.id}`,
        [
          { accountId: expenseAccountId, debit: amount, description: 'End of service benefits accrual' },
          { accountId: payableAccountId, credit: amount, description: 'End of service benefits accrual' },
        ],
        actor,
      );
    } catch (err) {
      console.error(`Auto-posting failed for eosb_accrual ${employee.id}:`, err);
    }
    return amount;
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
  async runMonthlyEosbAccrual(actor: ActorRef = {}) {
    if (String(this.config.get('ACCRUAL_POSTING_ENABLED')).toLowerCase() === 'false') return;
    const employees = await this.employeeService.findAll();
    let posted = 0;
    for (const employee of employees) {
      if (!employee.active || employee.status !== 'working') continue;
      try {
        const amount = await this.postEosbFor(employee, actor);
        if (amount > 0) posted++;
      } catch (err) {
        this.logger.error(`EOSB accrual failed for employee ${employee.id}:`, err as Error);
      }
    }
    this.logger.log(`Monthly EOSB accrual run: ${posted} of ${employees.length} employee(s) posted.`);
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
