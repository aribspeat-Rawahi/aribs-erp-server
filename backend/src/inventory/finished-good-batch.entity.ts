import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { BatchSource } from './batch-source.enum';

// One row per "lot" of a finished good that entered stock — either from a
// completed Production Order, a manual/barcode stock-in, or (for stock
// that existed before this feature was added) an auto-created Opening
// Balance batch. Consumed FIFO by Sales Orders / stock-out scans (see
// BatchTrackingService.consumeFinishedGoodFifo).
@Entity('finished_good_batches')
export class FinishedGoodBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  finishedGoodId: string;

  // Human-readable lot code, e.g. "FG-20260924-A1B2C3".
  @Column({ unique: true })
  batchNumber: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantityProduced: number;

  // Decreases as sales/stock-outs consume from this batch (FIFO).
  @Column('decimal', { precision: 12, scale: 3 })
  quantityRemaining: number;

  @Column({ type: 'enum', enum: BatchSource })
  source: BatchSource;

  @Column({ nullable: true })
  productionOrderId: string;

  @Column({ type: 'date' })
  producedDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
