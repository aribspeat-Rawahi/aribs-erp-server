import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum RfqStatus {
  OPEN = 'open', // collecting quotes
  AWARDED = 'awarded', // a quote was chosen and its purchase order made
  CANCELLED = 'cancelled',
}

// Request for Quotation: the same list of items priced by several
// suppliers, compared side by side; the chosen quote becomes the purchase
// order (which then goes through its own approval).
@Index(['status'])
@Entity('rfqs')
export class Rfq {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  @Column({ type: 'varchar', length: 30, unique: true })
  rfqNumber: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  requisitionId: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'date', nullable: true })
  quotesDueBy: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 20, default: RfqStatus.OPEN })
  status: RfqStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  awardedQuoteId: string | null;

  // why this quote (required when it is not the lowest)
  @Column({ type: 'text', nullable: true })
  awardReason: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  purchaseOrderId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Index(['rfqId'])
@Entity('rfq_items')
export class RfqItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  rfqId: string;

  @Column({ type: 'varchar', length: 36 })
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  @Column({ length: 10, default: 'pcs' })
  unit: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  requisitionItemId: string | null;
}

@Index(['rfqId'])
@Entity('rfq_quotes')
export class RfqQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  rfqId: string;

  @Column({ type: 'varchar', length: 36 })
  supplierId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  quoteReference: string | null;

  @Column({ type: 'date', nullable: true })
  quoteDate: string | null;

  @Column({ type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ type: 'int', nullable: true })
  deliveryDays: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // JSON: [{ rfqItemId, unitPrice }] - a line left out = not quoted
  @Column({ type: 'text' })
  lines: string;

  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  subtotal: number;
  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  vatAmount: number;
  @Column('decimal', { precision: 14, scale: 3, default: 0 })
  total: number;

  @CreateDateColumn()
  createdAt: Date;
}
