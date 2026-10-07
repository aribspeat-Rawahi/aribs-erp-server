import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountType } from './account.entity';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

// Standard Chart of Accounts. Asset and Liability sections are the
// user-provided, Oman-VAT-aware curated list (2026-09-24 revision —
// replaced an earlier, more generic Zoho-template version of these two
// sections entirely, since this one is purpose-built for the business:
// proper VAT Receivable/Payable instead of US-style Sales Tax, named Bank/
// POS-settlement accounts, and a Packaging Materials inventory line).
// Equity/Revenue/Expense sections are unchanged from the broader COA
// template merged in earlier the same day, plus the handful of ARIBS/
// Palm-Peat-specific Expense accounts this system already relies on
// elsewhere (e.g. "Employee Reimbursements" is posted to by
// ReimbursementService.markPaid()).
// Seeded additively on every startup (see onModuleInit below) — a code
// that changed meaning between revisions (e.g. old "1010 Copyrights" is
// now "1010 Bank — Current Account") only takes effect for accounts not
// already created; an already-seeded account with the old name at that
// code is left alone and must be edited/deactivated by hand from the
// Chart of Accounts tab if no longer wanted.
const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  // Asset
  { code: '1000', name: 'Cash in Hand', type: AccountType.ASSET },
  { code: '1010', name: 'Bank — [Bank Name] — Current Account', type: AccountType.ASSET },
  { code: '1011', name: 'Bank — [Bank Name] — Savings Account', type: AccountType.ASSET },
  { code: '1012', name: 'Bank — Machine Payment / POS Settlement', type: AccountType.ASSET },
  { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET },
  // Contra-asset (credit balance) — same pattern as "1590 Accumulated
  // Depreciation" below. Net against 1100 on the Balance Sheet for a
  // realistic (collectible) receivables figure; pair with the "685
  // Provision for Doubtful Debts" expense below when writing the
  // estimate off.
  { code: '1105', name: 'Allowance for Doubtful Accounts', type: AccountType.ASSET },
  { code: '1200', name: 'Inventory — Raw Materials', type: AccountType.ASSET },
  { code: '1210', name: 'Inventory — Finished Goods', type: AccountType.ASSET },
  { code: '1220', name: 'Inventory — Packaging Materials', type: AccountType.ASSET },
  // Manufacturing Work-in-Progress — a production run that's been
  // started (material issued) but not yet finished/received into
  // Finished Goods. Production Orders in this system complete
  // atomically (consume → produce in one step), so nothing auto-posts
  // here yet; it's available for a manual Journal Entry if a run spans
  // more than one accounting period.
  { code: '1230', name: 'Inventory — Work in Progress', type: AccountType.ASSET },
  { code: '1300', name: 'Prepaid Expenses', type: AccountType.ASSET },
  // Optional clearing account for a Fund Transfer marked "in transit" —
  // see FundTransferService. Deliberately placed in the 1350 gap, well
  // outside the 1013+ range BankAccountService.createLinkedAssetAccount()
  // auto-assigns to new bank/cash accounts, so it can never collide with
  // a dynamically-created bank ledger account.
  { code: '1350', name: 'Money in Transit', type: AccountType.ASSET },
  // Advances paid to a supplier ahead of a bill (see VendorPrepaymentService)
  // — an asset until it's later applied against Accounts Payable.
  { code: '1310', name: 'Vendor Prepayments (Advances to Suppliers)', type: AccountType.ASSET },
  // Salary advances paid out to an employee ahead of their normal
  // payroll — an asset (money owed back by the employee) until it's
  // later settled, same treatment as Vendor Prepayments above. See
  // SalaryAdvanceService.disburse().
  { code: '1320', name: 'Employee Salary Advances', type: AccountType.ASSET },
  { code: '1360', name: 'Other Short-Term Asset', type: AccountType.ASSET },
  { code: '1400', name: 'VAT Receivable (Input VAT)', type: AccountType.ASSET },
  { code: '1500', name: 'Machinery & Equipment', type: AccountType.ASSET },
  { code: '1510', name: 'Furniture & Fixtures', type: AccountType.ASSET },
  { code: '1520', name: 'Vehicles', type: AccountType.ASSET },
  { code: '1530', name: 'Computer & Office Equipment', type: AccountType.ASSET },
  // Used by FixedAssetService for a registered asset that doesn't fit any
  // of the four categories above.
  { code: '1560', name: 'Other Long-Term Asset', type: AccountType.ASSET },
  { code: '1590', name: 'Accumulated Depreciation', type: AccountType.ASSET },

  // Liability
  { code: '2000', name: 'Accounts Payable', type: AccountType.LIABILITY },
  { code: '2100', name: 'VAT Payable (Output VAT)', type: AccountType.LIABILITY },
  { code: '2200', name: 'Salaries Payable', type: AccountType.LIABILITY },
  { code: '2300', name: 'Accrued Expenses', type: AccountType.LIABILITY },
  { code: '2400', name: 'Short-term Loans', type: AccountType.LIABILITY },
  { code: '2500', name: 'Bank Loans (Long-term)', type: AccountType.LIABILITY },
  { code: '2510', name: 'Equipment Financing / Lease', type: AccountType.LIABILITY },
  // Oman Labour Law mandates an end-of-service gratuity for eligible
  // employees on termination/resignation, accrued over their service —
  // not tracked anywhere in this system yet (Payroll has no accrual
  // posting); this account exists for a manual accrual entry each
  // period until that's automated.
  { code: '2150', name: 'End of Service Benefits (Gratuity) Payable', type: AccountType.LIABILITY },
  // Accrued but unpaid Oman corporate income tax — pairs with the
  // existing "710 Income Tax Expense" below.
  { code: '2160', name: 'Income Tax Payable', type: AccountType.LIABILITY },
  // Employer + employee Social Protection Fund (PASI) contributions
  // withheld/accrued but not yet remitted.
  { code: '2170', name: 'Social Insurance Payable (PASI)', type: AccountType.LIABILITY },
  // Cash received from a customer before the goods are delivered/
  // invoiced — a liability (owed goods or a refund) until earned.
  { code: '2180', name: 'Unearned Revenue / Customer Advances', type: AccountType.LIABILITY },
  // Temporary holding account for a receipt or payment that can't yet
  // be identified/allocated to its real account — cleared out once
  // investigated, never left with a balance at period end.
  { code: '2900', name: 'Suspense Account', type: AccountType.LIABILITY },

  // Equity
  { code: '300', name: "Owner's Contribution", type: AccountType.EQUITY },
  { code: '310', name: "Owner's Draw", type: AccountType.EQUITY },
  { code: '320', name: 'Retained Earnings', type: AccountType.EQUITY },
  { code: '330', name: 'Common Stock', type: AccountType.EQUITY },
  // Oman's Commercial Companies Law requires an LLC to transfer 10% of
  // annual net profit into a statutory legal reserve until it reaches
  // one-third of share capital — a restricted equity account, not
  // available for dividends/draws.
  { code: '340', name: 'Legal Reserve (Statutory)', type: AccountType.EQUITY },
  // Other side of every opening balance (Accounting > Opening Balances).
  // Its final balance is the company's equity on the opening date; the
  // accountant moves it to Capital / Retained Earnings with a journal.
  { code: '3900', name: 'Opening Balance Equity', type: AccountType.EQUITY },
  { code: '1301', name: "Owner's Equity", type: AccountType.EQUITY },
  { code: '1302', name: 'Paid-in Capital in Excess of Par — Common Stock', type: AccountType.EQUITY },
  { code: '1303', name: 'Paid-in Capital in Excess of Par — Preferred Stock', type: AccountType.EQUITY },
  { code: '1304', name: 'Preferred Stock', type: AccountType.EQUITY },
  { code: '1305', name: 'Treasury Stock', type: AccountType.EQUITY },
  { code: '1306', name: 'Dividends', type: AccountType.EQUITY },
  { code: '1307', name: 'Income Summary', type: AccountType.EQUITY },

  // Revenue
  { code: '400', name: 'Sales', type: AccountType.REVENUE },
  { code: '460', name: 'Interest Income', type: AccountType.REVENUE },
  { code: '470', name: 'Other Revenue', type: AccountType.REVENUE },
  { code: '475', name: 'Purchase Discount', type: AccountType.REVENUE },
  { code: '1401', name: 'Service Revenue', type: AccountType.REVENUE },
  { code: '1402', name: 'Sales Revenue', type: AccountType.REVENUE },
  { code: '1403', name: 'Sales Returns and Allowance', type: AccountType.REVENUE },
  { code: '1404', name: 'Gain on Disposal of Plant Assets', type: AccountType.REVENUE },
  { code: '1405', name: 'Asset Sales', type: AccountType.REVENUE },
  { code: '1406', name: 'Sales Return Discount', type: AccountType.REVENUE },
  { code: '1407', name: 'Sales Return Tax', type: AccountType.REVENUE },
  { code: '1408', name: 'Purchase Return', type: AccountType.REVENUE },
  { code: '1409', name: 'Purchase Return VAT', type: AccountType.REVENUE },
  { code: '1410', name: 'Purchase Return Discount', type: AccountType.REVENUE },
  { code: '1411', name: 'Shipment', type: AccountType.REVENUE },

  // Expense
  { code: '500', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
  { code: '600', name: 'Advertising', type: AccountType.EXPENSE },
  { code: '605', name: 'Bank Service Charges', type: AccountType.EXPENSE },
  { code: '606', name: 'Bank Transaction Charge', type: AccountType.EXPENSE },
  { code: '607', name: 'Sales Return', type: AccountType.EXPENSE },
  { code: '610', name: 'Janitorial Expenses', type: AccountType.EXPENSE },
  { code: '615', name: 'Consulting & Accounting', type: AccountType.EXPENSE },
  { code: '620', name: 'Entertainment', type: AccountType.EXPENSE },
  { code: '624', name: 'Postage & Delivery', type: AccountType.EXPENSE },
  { code: '628', name: 'General Expenses', type: AccountType.EXPENSE },
  { code: '632', name: 'Insurance', type: AccountType.EXPENSE },
  { code: '636', name: 'Legal Expenses', type: AccountType.EXPENSE },
  { code: '640', name: 'Utilities', type: AccountType.EXPENSE },
  { code: '644', name: 'Automobile Expenses', type: AccountType.EXPENSE },
  { code: '648', name: 'Office Expenses', type: AccountType.EXPENSE },
  { code: '652', name: 'Printing & Stationery', type: AccountType.EXPENSE },
  { code: '656', name: 'Rent', type: AccountType.EXPENSE },
  { code: '660', name: 'Repairs & Maintenance', type: AccountType.EXPENSE },
  { code: '664', name: 'Wages & Salaries', type: AccountType.EXPENSE },
  { code: '668', name: 'Payroll Tax Expense', type: AccountType.EXPENSE },
  { code: '672', name: 'Dues & Subscriptions', type: AccountType.EXPENSE },
  { code: '676', name: 'Telephone & Internet', type: AccountType.EXPENSE },
  { code: '680', name: 'Travel', type: AccountType.EXPENSE },
  { code: '684', name: 'Bad Debts', type: AccountType.EXPENSE },
  // The period's estimated uncollectible-receivables charge — pairs
  // with the "1105 Allowance for Doubtful Accounts" contra-asset above.
  // Distinct from "684 Bad Debts" (a specific invoice written off
  // outright) vs. this (an estimate/provision set aside in advance).
  { code: '685', name: 'Provision for Doubtful Debts', type: AccountType.EXPENSE },
  { code: '700', name: 'Depreciation', type: AccountType.EXPENSE },
  { code: '710', name: 'Income Tax Expense', type: AccountType.EXPENSE },
  { code: '715', name: 'Employee Benefits Expense', type: AccountType.EXPENSE },
  // Pairs with "2150 End of Service Benefits (Gratuity) Payable" above.
  { code: '717', name: 'End of Service Benefits Expense', type: AccountType.EXPENSE },
  // The employer's own share of Social Protection Fund (PASI)
  // contributions — pairs with "2170 Social Insurance Payable" above.
  // Kept separate from "715 Employee Benefits Expense" since it's a
  // fixed statutory percentage worth tracking/reporting on its own.
  { code: '719', name: 'Social Insurance Contribution Expense (Employer)', type: AccountType.EXPENSE },
  { code: '800', name: 'Interest Expense', type: AccountType.EXPENSE },
  { code: '810', name: 'Bank Revaluations', type: AccountType.EXPENSE },
  { code: '815', name: 'Unrealized Currency Gains', type: AccountType.EXPENSE },
  { code: '820', name: 'Realized Currency Gains', type: AccountType.EXPENSE },
  { code: '825', name: 'Sales Discount', type: AccountType.EXPENSE },
  { code: '1501', name: 'Amortization Expense', type: AccountType.EXPENSE },
  { code: '1502', name: 'Freight-Out', type: AccountType.EXPENSE },
  { code: '1503', name: 'Insurance Expense', type: AccountType.EXPENSE },
  { code: '1504', name: 'Loss on Disposal of Plant Assets', type: AccountType.EXPENSE },
  { code: '1505', name: 'Maintenance and Repairs Expense', type: AccountType.EXPENSE },
  { code: '1506', name: 'Purchase', type: AccountType.EXPENSE },
  { code: '1507', name: 'Asset Purchase', type: AccountType.EXPENSE },
  { code: '1509', name: 'Purchase VAT', type: AccountType.EXPENSE },
  { code: '5100', name: 'Raw Material Purchases', type: AccountType.EXPENSE },
  // stock count corrections, manual stock in/out, write-offs (at cost)
  { code: '5110', name: 'Inventory Adjustments', type: AccountType.EXPENSE },
  { code: '5600', name: 'Office Supplies Expense', type: AccountType.EXPENSE },
  { code: '5700', name: 'Employee Reimbursements', type: AccountType.EXPENSE },
];

@Injectable()
export class AccountService implements OnModuleInit {
  constructor(
    @InjectRepository(Account)
    private repo: Repository<Account>,
  ) {}

  // Runs at every app startup — seeds only the default accounts that are
  // still missing (matched by code), so this is safe to leave in place
  // permanently: a no-op once everything is present, additive if
  // DEFAULT_ACCOUNTS grows later, and safe to run against a DB that
  // already has an earlier, smaller version of this seed list. Never
  // touches an account the user has already added, edited, or deactivated.
  async onModuleInit() {
    const existing = await this.repo.find();
    const existingCodes = new Set(existing.map((a) => a.code));
    const missing = DEFAULT_ACCOUNTS.filter((a) => !existingCodes.has(a.code));
    if (missing.length === 0) return;
    const rows = missing.map((a) => this.repo.create({ ...a, active: true }));
    await this.repo.save(rows);
  }

  findAll(includeInactive = false) {
    return this.repo.find({
      where: includeInactive ? {} : { active: true },
      order: { code: 'ASC' },
    });
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Account not found');
    return item;
  }

  findByCode(code: string) {
    return this.repo.findOne({ where: { code } });
  }

  // Next unused code at or after `base` — used when auto-creating a
  // Chart-of-Accounts account for a new BankAccount (see
  // BankAccountService.linkToJournalAccount()) so each bank/cash account
  // the user creates gets its own GL line without ever colliding with an
  // existing code.
  private async nextAvailableCode(base: number): Promise<string> {
    let code = base;
    // eslint-disable-next-line no-await-in-loop
    while (await this.repo.findOne({ where: { code: String(code) } })) code++;
    return String(code);
  }

  // Auto-creates a new active Asset account for a BankAccount to link
  // to — starting from `baseCode` and incrementing until a free code is
  // found. Not exposed over HTTP; only called from BankAccountService.
  async createLinkedAssetAccount(name: string, baseCode: number) {
    const code = await this.nextAvailableCode(baseCode);
    const item = this.repo.create({ code, name, type: AccountType.ASSET, active: true });
    return this.repo.save(item);
  }

  async create(dto: CreateAccountDto) {
    const existing = await this.repo.findOne({ where: { code: dto.code } });
    if (existing) throw new BadRequestException(`Account code "${dto.code}" is already in use`);
    const item = this.repo.create({ ...dto, active: true });
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateAccountDto) {
    const item = await this.findOne(id);
    if (dto.code && dto.code !== item.code) {
      const existing = await this.repo.findOne({ where: { code: dto.code } });
      if (existing) throw new BadRequestException(`Account code "${dto.code}" is already in use`);
    }
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  // Accounts are never hard-deleted once created — they may already be
  // referenced by Journal Entry lines, so "delete" just deactivates it
  // (it drops out of the active list used by the New Journal Entry form,
  // but stays visible in historical entries/reports).
  async remove(id: string) {
    const item = await this.findOne(id);
    item.active = false;
    await this.repo.save(item);
    return { deactivated: true };
  }
}
