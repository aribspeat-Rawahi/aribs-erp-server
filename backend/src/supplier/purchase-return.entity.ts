import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { PurchaseReturnItem } from './purchase-return-item.entity';

export enum PurchaseReturnStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// Returning some or all of a RECEIVED Purchase Order's goods back to the
// supplier. Goes through a pending->approve/reject workflow (unlike Fund
// Transfer/Tax Payment, which post immediately) since it reverses real
// stock and money that already moved — approve()/reject() are gated the
// same way Reimbursement.approve()/reject() are. Only on approve() does
// it actually decrease raw material stock and (optionally) record a
// bank/cash deposit + auto-post the Journal Entry; reject() has no
// stock/ledger effect at all.
@Entity('purchase_returns')
export class PurchaseReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "PR-20260924-A1B2C3" — same generator
  // pattern as claimNumber/entryNumber/transferNumber/paymentNumber.
  @Column({ unique: true })
  returnNumber: string;

  // References PurchaseOrder.id — must be a RECEIVED order (see
  // PurchaseReturnService.create()). No DB foreign key, same convention
  // used throughout this codebase.
  @Column()
  purchaseOrderId: string;

  @Column()
  supplierId: string;

  @Column({ type: 'enum', enum: PurchaseReturnStatus, default: PurchaseReturnStatus.PENDING })
  status: PurchaseReturnStatus;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true, type: 'text' })
  reason?: string;

  // Totals across all items — same shape as PurchaseOrder.subtotal/vatAmount/total.
  @Column('decimal', { precision: 12, scale: 3 })
  subtotal: number;
  @Column('decimal', { precision: 12, scale: 3 })
  vatAmount: number;
  @Column('decimal', { precision: 12, scale: 3 })
  total: number;

  // If set, the refund is recorded as a real deposit on this bank/cash
  // account when approved (bankTransactionId links to that deposit so it
  // can be found later, same convention as Reimbursement/TaxPayment).
  // Left blank, the refund is just a credit against Accounts Payable —
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

  @OneToMany(() => PurchaseReturnItem, (item) => item.purchaseReturn, { cascade: true })
  items: PurchaseReturnItem[];

  @CreateDateColumn()
  createdAt: Date;
}
