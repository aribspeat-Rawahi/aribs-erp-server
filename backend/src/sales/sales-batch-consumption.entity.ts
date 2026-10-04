import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Links a Sales Order (or a manual/barcode stock-out) to the specific
// finished good batch(es) it drew from (FIFO) — the "which product lot did
// this customer's order ship from" record, which combined with
// ProductionBatchConsumption traces all the way back to raw material lots
// and their suppliers.
@Entity('sales_batch_consumptions')
export class SalesBatchConsumption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Set for a real Sales Order; left blank for a manual/barcode stock-out
  // (see BatchTrackingService.consumeFinishedGoodFifo callers).
  @Column({ nullable: true })
  salesOrderId: string;

  // Stock now leaves with the invoice (sales orders no longer move stock).
  @Column({ type: 'varchar', length: 36, nullable: true })
  invoiceId: string | null;

  @Column()
  finishedGoodBatchId: string;

  @Column()
  finishedGoodId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantityConsumed: number;

  @CreateDateColumn()
  createdAt: Date;
}
