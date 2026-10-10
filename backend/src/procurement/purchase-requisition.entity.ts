import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum RequisitionStatus {
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  CLOSED = 'closed', // nothing more will be ordered on it
}

// Purchase Requisition: an internal request to buy (what, how much, by
// when, why). No accounting effect - it is the permission to start buying.
// How much of it has been ordered is worked out from the purchase orders
// linked to its lines (cancelled/rejected orders don't count).
@Index(['status'])
@Entity('purchase_requisitions')
export class PurchaseRequisition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  @Column({ type: 'varchar', length: 30, unique: true })
  prNumber: string;

  @Column({ type: 'varchar', length: 20, default: RequisitionStatus.PENDING_APPROVAL })
  status: RequisitionStatus;

  @Column({ type: 'date', nullable: true })
  neededBy: string | null;

  @Column({ type: 'text' })
  purpose: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  estimatedTotal: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  requestedByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  requestedByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;
  @UpdateDateColumn()
  updatedAt: Date;
}

@Index(['requisitionId'])
@Entity('purchase_requisition_items')
export class PurchaseRequisitionItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  requisitionId: string;

  @Column({ type: 'varchar', length: 36 })
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  @Column({ length: 10, default: 'pcs' })
  unit: string;

  // a rough price, for the approval amount; the real price comes from the
  // supplier (RFQ / purchase order)
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  estimatedUnitCost: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;
}
