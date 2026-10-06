import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Index(['purchaseOrderId'])
@Entity('purchase_order_items')
export class PurchaseOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  purchaseOrderId: string;

  @Column()
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  // pcs | bags | kg | litre | ton (see units/units.ts) - copied from the
  // product when the line is saved, so old documents keep their unit.
  @Column({ length: 10, default: 'pcs' })
  unit: string;

  @Column('decimal', { precision: 12, scale: 3 })
  costPerUnit: number;

  // VAT rate (%) applied to this line — defaults to 5 (Oman standard
  // rate) if not given, same convention as InvoiceItem.vatRate.
  @Column('decimal', { precision: 6, scale: 3, default: 5 })
  vatRate: number;

  // how much of this line has arrived so far (goods receipts)
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  receivedQuantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
