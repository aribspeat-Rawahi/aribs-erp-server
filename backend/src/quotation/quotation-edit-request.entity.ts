import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum QuotationEditStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// A same-day edit to a quotation applies immediately (no approval needed —
// treated as fixing a mistake made minutes ago). Once the calendar day has
// moved on, editing prices/items on a quotation the customer may already
// be looking at needs sign-off — this row holds that pending change until
// an authorized approver acts on it.
@Entity('quotation_edit_requests')
export class QuotationEditRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  quotationId: string;

  // The proposed new item list + validUntil, stored as JSON until approved.
  @Column({ type: 'text' })
  proposedItems: string;

  @Column({ type: 'date', nullable: true })
  proposedValidUntil: string;

  // Nullable = "no discount change proposed"; 0 is a valid proposed value
  // (removing an existing discount), so this can't reuse proposedItems'
  // empty-array-means-nothing convention.
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  proposedDiscountAmount?: number;

  @Column({ type: 'enum', enum: QuotationEditStatus, default: QuotationEditStatus.PENDING })
  status: QuotationEditStatus;

  @Column({ nullable: true })
  requestedByUserId?: string;

  @Column({ nullable: true })
  requestedByEmail?: string;

  @Column({ nullable: true })
  approvedByUserId?: string;

  @Column({ nullable: true })
  approvedByEmail?: string;

  @Column({ nullable: true })
  decidedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
