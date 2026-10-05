import { Column, CreateDateColumn, Entity, Generated, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { GoodsReceiptItem } from './goods-receipt-item.entity';

// Goods Received Note (GRN): one delivery from the supplier against a
// purchase order. A PO can arrive in several deliveries; each one adds
// stock (traceable batches) and its own payable + input VAT journal entry.
@Entity('goods_receipts')
export class GoodsReceipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  // GRN-2026-0001
  @Column({ type: 'varchar', length: 30, unique: true })
  grnNumber: string;

  @Column({ type: 'varchar', length: 36 })
  purchaseOrderId: string;

  @Column({ type: 'varchar', length: 36 })
  supplierId: string;

  @Column({ type: 'date' })
  receivedDate: string;

  // The supplier's tax invoice for these goods - required to claim the
  // input VAT (Oman VAT law).
  @Column({ type: 'varchar', length: 60, nullable: true })
  supplierInvoiceNumber: string | null;
  @Column({ type: 'date', nullable: true })
  supplierInvoiceDate: string | null;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  subtotal: number;
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  vatAmount: number;
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  total: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByEmail: string | null;

  @OneToMany(() => GoodsReceiptItem, (i) => i.goodsReceipt, { cascade: true })
  items: GoodsReceiptItem[];

  @CreateDateColumn()
  createdAt: Date;
}
