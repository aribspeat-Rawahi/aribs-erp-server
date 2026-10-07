import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// Represents a manufactured product ready for sale.
// Stock here goes UP when a Production Order completes,
// and goes DOWN when a Sales Order / Invoice is issued (via scan or manual).
@Entity('finished_goods')
export class FinishedGood {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true, nullable: true })
  sku: string;

  // Provided by the user at creation time — e.g. an official GS1 barcode
  // already printed on packaging, or a manually assigned code for
  // products that don't have one yet. Not auto-generated.
  @Column({ unique: true })
  barcode: string;

  @Column()
  unit: string;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  quantityInStock: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  lowStockThreshold: number;

  // Default selling price — can still be manually overridden on
  // quotations (see Quotation module).
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  sellingPrice: number;

  // Weighted-average production cost per unit — used for COGS/Gross
  // Profit on the Dashboard. Editable manually, but also auto-updated by
  // ProductionOrderService.complete() every time a batch is produced: the
  // new batch's unit cost (from its BOM's raw material costs) is blended
  // with whatever's already in stock, same "moving average" costing
  // convention RawMaterial-consuming code elsewhere in this codebase
  // already assumes. Starts at 0 for a product that's never been produced
  // through a BOM yet (e.g. one only ever stocked in manually) — set it
  // by hand in that case for COGS to reflect reality.
  // 6 decimals: stock value = quantity x cost must not drift from the ledger
  @Column('decimal', { precision: 16, scale: 6, default: 0 })
  costPerUnit: number;

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number; // Oman standard VAT = 5%

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
