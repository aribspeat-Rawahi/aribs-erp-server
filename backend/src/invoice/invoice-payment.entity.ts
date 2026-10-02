import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { PaymentType } from '../common/payment-type.enum';

// One row per payment received against an invoice — an invoice can be
// paid in several installments, so this is a running ledger rather than
// a single "paid/unpaid" flag. Invoice.paidAmount/paymentStatus are kept
// in sync (denormalized) every time a row here is added or removed, so
// the invoice list and Aging Report don't need to sum this table on
// every read.
@Entity('invoice_payments')
export class InvoicePayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  invoiceId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'date' })
  paymentDate: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  // Set only when this payment was recorded as an automatic bank/cash
  // deposit (see InvoicePaymentService) — mirrors
  // Reimbursement.bankAccountId/bankTransactionId. Optional: leaving it
  // blank keeps this a record-only payment (no bank movement, no
  // auto-posted journal entry).
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
