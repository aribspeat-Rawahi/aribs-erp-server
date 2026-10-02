import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A record of VAT/tax actually paid to (or refunded by) the tax
// authority for a filing period — separate from TaxRate (the rate
// reference list). Optionally synced to a bank/cash account the same way
// Reimbursement.markPaid() is: set bankAccountId to auto-record a real
// withdrawal, leave it blank for a record-only entry.
@Entity('tax_payments')
export class TaxPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "TX-20260924-A1B2C3" — same generator
  // pattern as claimNumber/entryNumber/transferNumber.
  @Column({ unique: true })
  paymentNumber: string;

  // The VAT filing period this payment covers, e.g. "Q1 2026" or
  // "January 2026" — free text since Oman's filing cadence can vary by
  // business (monthly/quarterly).
  @Column()
  period: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  datePaid: string;

  // Tax authority receipt/reference number, if any.
  @Column({ nullable: true })
  reference?: string;

  @Column({ nullable: true, type: 'text' })
  note?: string;

  // Supporting document (payment challan, receipt) — same magic-byte
  // upload pattern as Expense/Reimbursement/FundTransfer.
  @Column({ nullable: true })
  documentFilePath?: string;

  // Set only when this payment was recorded as an automatic bank/cash
  // withdrawal (see TaxPaymentService) — mirrors
  // Reimbursement.bankAccountId/bankTransactionId.
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
