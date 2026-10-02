import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { BatchSource } from './batch-source.enum';

// One row per "lot" of a raw material that entered stock — either from a
// received Purchase Order line item, or (for stock that existed before
// this feature was added) an auto-created Opening Balance batch. Consumed
// FIFO by Production Orders (see BatchTrackingService.consumeRawMaterialFifo).
@Entity('raw_material_batches')
export class RawMaterialBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  rawMaterialId: string;

  // Human-readable lot code, e.g. "RM-20260924-A1B2C3".
  @Column({ unique: true })
  batchNumber: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantityReceived: number;

  // Decreases as Production Orders consume from this batch (FIFO).
  // Stays 0 once fully consumed — never deleted, kept for the trace history.
  @Column('decimal', { precision: 12, scale: 3 })
  quantityRemaining: number;

  // Cost snapshot at the time this lot was received (0 for an Opening
  // Balance batch where the original purchase cost isn't known per-lot).
  @Column('decimal', { precision: 12, scale: 3 })
  costPerUnit: number;

  @Column({ type: 'enum', enum: BatchSource })
  source: BatchSource;

  @Column({ nullable: true })
  purchaseOrderId: string;

  @Column({ nullable: true })
  supplierId: string;

  // Free-text note for a manually added batch (e.g. "Opening stock",
  // "Stock count correction") — set from the Inventory "Add stock" modal.
  // Blank for purchase-order-received / opening-balance batches.
  @Column({ nullable: true })
  notes: string;

  @Column({ type: 'date' })
  receivedDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
