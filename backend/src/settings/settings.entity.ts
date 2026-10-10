import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

// Matches the three HTML designs already built:
// classic (round logo, centered watermark, minimal),
// formal (bordered boxes, Quotation-PDF style, bank details + 3 signatures),
// po_style (letterhead header, Purchase-Order-PDF style, Gross/Taxable/VAT/Net breakdown).
export enum InvoiceTemplate {
  CLASSIC = 'classic',
  FORMAL = 'formal',
  PO_STYLE = 'po_style',
}

// Single-row table (id is always 1) — one company, one settings record.
@Entity('settings')
export class Settings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  logoPath: string;

  @Column({ default: 'ARIBS Palm Peat' })
  companyName: string;

  @Column({ nullable: true })
  companyVatin: string;

  @Column({ nullable: true })
  companyAddress: string;

  @Column({ nullable: true })
  companyPhone: string;

  // Omani letterhead details (shown on purchasing documents such as RFQs)
  @Column({ type: 'varchar', length: 200, nullable: true })
  companyNameArabic: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true })
  companyCrNumber: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true })
  companyEmail: string | null;

  @Column({ type: 'enum', enum: InvoiceTemplate, default: InvoiceTemplate.CLASSIC })
  defaultInvoiceTemplate: InvoiceTemplate;

  // Comma-separated day-of-week numbers that are company-wide weekly off
  // days (0 = Sunday … 6 = Saturday, matching JS Date#getDay()). e.g.
  // "5,6" for a Friday/Saturday weekend. Empty/null = no weekly off set.
  // Used by the HR Attendance page to flag/label off days.
  @Column({ nullable: true })
  weeklyOffDays: string;

  // Standard work shift, e.g. "08:30" / "17:00". Used by
  // AttendanceService to auto-derive present/late and auto-calculate
  // overtime from check-in/check-out times (manual entry today, a
  // fingerprint/biometric device punch later). Null = auto-calc is
  // skipped and attendance stays fully manual.
  @Column({ type: 'time', nullable: true })
  shiftStartTime: string;

  @Column({ type: 'time', nullable: true })
  shiftEndTime: string;

  // Grace period in minutes around shift start/end: a check-in within
  // this many minutes of shiftStartTime still counts as on-time; a
  // check-out within this many minutes of shiftEndTime is not overtime.
  // Once either grace window is exceeded, the FULL difference counts
  // (i.e. overtime is not reduced by the grace amount) — this matches
  // how the company's payroll rule was specified.
  @Column({ type: 'int', default: 15 })
  attendanceGraceMinutes: number;

  // Oman standard corporate income tax rate (%), used by
  // AccrualPostingService's monthly Income Tax Provision cron to accrue
  // Dr 710 Income Tax Expense / Cr 2160 Income Tax Payable against
  // year-to-date net profit. Editable here in case a different rate/
  // threshold applies once confirmed with an accountant.
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 15 })
  incomeTaxRatePercent: number;

  // Social Protection Fund (Omani staff, Social Protection Law RD 52/2023):
  // employee share deducted from pay, employer share an expense; both on
  // the wage up to the ceiling. Confirm the rates with the SPF / accountant.
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 8 })
  spfEmployeeRatePercent: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 13.5 })
  spfEmployerRatePercent: number;

  @Column({ type: 'decimal', precision: 12, scale: 3, default: 3000 })
  spfWageCeiling: number;

  // Expatriate savings scheme start: it replaces end-of-service gratuity,
  // so EOSB stops accruing for service after this date.
  @Column({ type: 'date', nullable: true, default: '2027-07-19' })
  expatSavingsSchemeStart: string | null;

  // Opening balances (Accounting > Opening Balances): the last day of the
  // old books. Once finalized, nothing can be posted on or before this
  // date (see JournalPostingService.assertDateOpen).
  @Column({ type: 'date', nullable: true })
  openingBalanceDate: string | null;

  @Column({ type: 'datetime', nullable: true })
  openingBalanceFinalizedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  openingBalanceFinalizedBy: string | null;

  // VAT return periods (Accounting > Tax > VAT Returns): length in months
  // (3 = quarterly, the Oman default; 1 = monthly) and the month a period
  // cycle starts in (1 = Jan-Mar, Apr-Jun...; 2 = Feb-Apr...). As on the
  // OTA registration.
  @Column({ type: 'int', default: 3 })
  vatPeriodMonths: number;

  @Column({ type: 'int', default: 1 })
  vatPeriodStartMonth: number;

  // Effective date of the company's VAT registration with the Oman Tax
  // Authority. No date = not registered: no VAT returns are due (a
  // business under construction with no taxable sales yet).
  @Column({ type: 'date', nullable: true })
  vatRegisteredFrom: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
