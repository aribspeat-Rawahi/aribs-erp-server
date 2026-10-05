import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { GoodsReceipt } from './goods-receipt.entity';

// One received line of a GRN - price/VAT copied from the PO line.
@Entity('goods_receipt_items')
export class GoodsReceiptItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => GoodsReceipt, (r) => r.items)
  @JoinColumn({ name: 'goodsReceiptId' })
  goodsReceipt: GoodsReceipt;

  @Column({ type: 'varchar', length: 36 })
  goodsReceiptId: string;

  @Column({ type: 'varchar', length: 36 })
  purchaseOrderItemId: string;

  @Column({ type: 'varchar', length: 36 })
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  @Column({ length: 10, default: 'pcs' })
  unit: string;

  @Column('decimal', { precision: 12, scale: 3 })
  costPerUnit: number;

  @Column('decimal', { precision: 6, scale: 3, default: 5 })
  vatRate: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  lineTotal: number;
}
