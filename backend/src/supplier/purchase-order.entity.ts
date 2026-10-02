import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentStatus } from '../common/payment-type.enum';

export enum PurchaseOrderStatus {
  ORDERED = 'ordered', // sent to supplier, not yet received
  RECEIVED = 'received', // goods arrived, stock updated
  CANCELLED = 'cancelled',
}

@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
