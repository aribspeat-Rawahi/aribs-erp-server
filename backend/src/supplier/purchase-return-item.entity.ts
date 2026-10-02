import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PurchaseReturn } from './purchase-return.entity';

// One returned line — costPerUnit/vatRate are copied from the original
// PurchaseOrderItem at create time (not taken from the client), so a
// return's value always matches what was actually paid for that material
// on that order.
@Entity('purchase_return_items')
export class PurchaseReturnItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PurchaseReturn, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchaseReturnId' })
  purchaseReturn: PurchaseReturn;

  @Column()
  purchaseReturnId: string;

  @Column()
  rawMaterialId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  @Column('decimal', { precision: 12, scale: 3 })
  costPerUnit: number;

  @Column('decimal', { precision: 6, scale: 3 })
  vatRate: number;
}
