import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { PaymentType } from '../common/payment-type.enum';

// One row per payment made to a supplier against a RECEIVED purchase
// order — a PO can be paid in several installments, so this is a running
// ledger rather than a single "paid/unpaid" flag. Mirrors InvoicePayment
// exactly (the sales-side equivalent), just Dr Accounts Payable instead
// of Cr Accounts Receivable. PurchaseOrder.paidAmount/paymentStatus are
// kept in sync (denormalized) every time a row here is added or removed.
@Index(['purchaseOrderId'])
@Index(['supplierId'])
@Index(['paymentDate'])
@Entity('supplier_payments')
export class SupplierPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  purchaseOrderId: string;

  // Denormalized from the PO at creation time — lets the Suppliers page
  // list "all payments to this supplier" without joining every PO.
  @Column()
  supplierId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'date' })
  paymentDate: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  // Set only when this payment was recorded as an automatic bank/cash
  // withdrawal — mirrors InvoicePayment.bankAccountId/bankTransactionId.
  // Optional: leaving it blank keeps this a record-only payment (no bank
  // movement, no auto-posted journal entry).
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  // Set when this row is not money paid but a credit that lowers what is
  // owed on the order: 'debit_note' (approved purchase return),
  // 'vendor_credit' or 'vendor_prepayment' (applied to this order). Its
  // accounting is part of that record's own journal entry.
  @Column({ type: 'varchar', length: 30, nullable: true })
  creditSource: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true })
  creditSourceId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
