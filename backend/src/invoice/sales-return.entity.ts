import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, Index } from 'typeorm';
import { SalesReturnItem } from './sales-return-item.entity';

export enum SalesReturnStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// Returning some or all of an issued Invoice's goods from the customer.
// Same pending->approve/reject workflow as PurchaseReturn, for the same
// reason: it reverses real stock and money, so it needs sign-off before
// anything actually moves. Only approve() increases finished-good stock
// and (optionally) records a bank/cash withdrawal + auto-posts the
// Journal Entry; reject() has no stock/ledger effect.
@Index(['customerId'])
@Index(['invoiceId'])
@Index(['date'])
@Entity('sales_returns')
export class SalesReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "SR-20260924-A1B2C3" — same generator
  // pattern as claimNumber/entryNumber/transferNumber/paymentNumber/returnNumber.
  @Column({ unique: true })
  returnNumber: string;

  // References Invoice.id — no DB foreign key, same convention used
  // throughout this codebase.
  @Column()
  invoiceId: string;

  @Column()
  customerId: string;

  @Column({ type: 'enum', enum: SalesReturnStatus, default: SalesReturnStatus.PENDING })
  status: SalesReturnStatus;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true, type: 'text' })
  reason?: string;

  // Totals across all items — same shape as Invoice.subtotal/vatAmount/total.
  @Column('decimal', { precision: 12, scale: 3 })
  subtotal: number;
  @Column('decimal', { precision: 12, scale: 3 })
  vatAmount: number;
  @Column('decimal', { precision: 12, scale: 3 })
  total: number;

  // If set, the refund is recorded as a real withdrawal on this bank/cash
  // account when approved (bankTransactionId links to that withdrawal).
  // Left blank, the refund is just a credit against Accounts Receivable —
  // no bank movement, no BankTransaction row.
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  @Column({ nullable: true })
  requestedByUserId?: string;
  @Column({ nullable: true })
  requestedByEmail?: string;

  @Column({ nullable: true })
  decidedByUserId?: string;
  @Column({ nullable: true })
  decidedByEmail?: string;
  @Column({ nullable: true })
  decidedAt?: Date;

  @Column({ nullable: true, type: 'text' })
  rejectionReason?: string;

  // On approval: the part that reduced the invoice's balance due, and the
  // part paid back to the customer (only when they had already paid).
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  appliedToInvoice: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  refundAmount: number;

  @OneToMany(() => SalesReturnItem, (item) => item.salesReturn, { cascade: true })
  items: SalesReturnItem[];

  @CreateDateColumn()
  createdAt: Date;
}
