import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Represents raw materials used to manufacture finished goods.
// Stock here goes DOWN when a Production Order consumes materials (via BOM),
// and goes UP when new raw material is purchased/received from a Supplier.
@Index(['supplierId'])
@Entity('raw_materials')
export class RawMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true, nullable: true })
  sku: string; // internal reference code

  @Column({ unique: true, nullable: true })
  barcode: string; // for scanner-based stock-in

  @Column()
  unit: string; // kg, ltr, pcs, meter etc.

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  quantityInStock: number;

  // Alert threshold — when stock falls at/below this, a low-stock
  // notification should be triggered.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  lowStockThreshold: number;

  // 6 decimals: stock value = quantity x cost must not drift from the ledger
  @Column('decimal', { precision: 16, scale: 6, default: 0 })
  costPerUnit: number;

  @Column({ nullable: true })
  supplierId: string;

  // Inventory Reorder Automation — how much to suggest ordering once
  // stock falls at/below lowStockThreshold. Blank means the reorder
  // suggestion falls back to a simple heuristic (see
  // RawMaterialService.getReorderSuggestions()).
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  reorderQuantity: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
