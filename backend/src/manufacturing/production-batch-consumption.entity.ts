import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Links one Production Order run to the specific raw material batch(es) it
// drew from (FIFO), and to the finished good batch it produced. This is
// the core "which raw material lots went into this product lot" record —
// a production run needing 3 raw materials, each drawn from 2 batches,
// produces 6 rows here, all sharing the same finishedGoodBatchId.
@Index(['productionOrderId'])
@Index(['rawMaterialBatchId'])
@Entity('production_batch_consumptions')
export class ProductionBatchConsumption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productionOrderId: string;

  // The finished good batch this production run created.
  @Column()
  finishedGoodBatchId: string;

  // The raw material batch this quantity was drawn from.
  @Column()
  rawMaterialBatchId: string;

  @Column()
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantityConsumed: number;

  @CreateDateColumn()
  createdAt: Date;
}
