import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Generated, Index } from 'typeorm';
import { PaymentStatus } from '../common/payment-type.enum';

export enum PurchaseOrderStatus {
  PENDING_APPROVAL = 'pending_approval', // waiting for approval (Settings > Approval rules)
  REJECTED = 'rejected', // an approver rejected it - edit and resubmit, or cancel
  ORDERED = 'ordered', // approved / sent to supplier, not yet received
  PARTIALLY_RECEIVED = 'partially_received', // some goods arrived (one or more GRNs)
  RECEIVED = 'received', // everything arrived (or closed short), stock updated
  CANCELLED = 'cancelled',
}

@Index(['supplierId'])
@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  // PO-2026-0001
  @Column({ type: 'varchar', length: 30, unique: true })
  poNumber: string;

  @Column()
  supplierId: string;

  @Column({ type: 'enum', enum: PurchaseOrderStatus, default: PurchaseOrderStatus.ORDERED })
  status: PurchaseOrderStatus;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  receivedAt: Date;

  // Totals across all items (quantity*costPerUnit and its VAT) — computed
  // and kept in sync by PurchaseOrderService on create/update, same
  // pattern as Invoice.subtotal/vatAmount/total. Nullable only so an
  // order created before this feature existed can still be read; a
  // freshly created/edited order always has all three set.
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  subtotal?: number;
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  vatAmount?: number;
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  total?: number;

  // Supplier Payment (Pay Bills) — how much of `total` has actually been
  // paid to the supplier, kept in sync by SupplierPaymentService every
  // time a payment row is added/removed (same denormalized pattern as
  // Invoice.paidAmount/paymentStatus). Nullable/undefined = no payment
  // ever recorded (treated as 0/DUE) — same "created before this feature
  // existed" fallback used elsewhere.
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  paidAmount?: number;
  @Column({ type: 'enum', enum: PaymentStatus, nullable: true })
  paymentStatus?: PaymentStatus;

  // when the goods are expected (Not Received Yet list / overdue)
  @Column({ type: 'date', nullable: true })
  expectedDate: string | null;

  // Value of what has actually been received (sum of its goods receipts).
  // This - not the ordered total - is what is owed to the supplier.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  receivedSubtotal: number;
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  receivedVat: number;
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  receivedTotal: number;

  // true when the order was closed before everything arrived
  @Column({ default: false })
  closedShort: boolean;

  // An unpaid supplier bill from the old books (Opening Balances page).
  // No items or goods receipts; left out of purchase and VAT reports,
  // but payable with Pay Bill like any received order.
  @Column({ default: false })
  isOpening: boolean;

  // The supplier's own bill number for an opening bill.
  @Column({ type: 'varchar', length: 100, nullable: true })
  openingReference: string | null;

  // When the bill has to be paid (opening bills).
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  // A supplier bill for a fixed asset bought on credit (no items or
  // goods receipts; edited only through the fixed asset).
  @Column({ type: 'varchar', length: 36, nullable: true })
  fixedAssetId: string | null;

  // made from a purchase requisition / an RFQ's chosen quote
  @Column({ type: 'varchar', length: 36, nullable: true })
  requisitionId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true })
  rfqId: string | null;

  // the total that was approved (an edit above it needs approval again)
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  approvedAmount: number | null;
  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
