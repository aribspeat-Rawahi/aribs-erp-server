import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { SalesReturn } from './sales-return.entity';

// One returned line — unitPrice/vatRate are copied from the original
// InvoiceItem at create time (not taken from the client), so a return's
// value always matches what was actually billed for that product on
// that invoice.
@Entity('sales_return_items')
export class SalesReturnItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => SalesReturn, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'salesReturnId' })
  salesReturn: SalesReturn;

  @Column()
  salesReturnId: string;

  @Column()
  finishedGoodId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  // pcs | bags | kg | litre | ton (see units/units.ts) - copied from the
  // product when the line is saved, so old documents keep their unit.
  @Column({ length: 10, default: 'pcs' })
  unit: string;

  @Column('decimal', { precision: 12, scale: 3 })
  unitPrice: number;

  @Column('decimal', { precision: 6, scale: 3 })
  vatRate: number;
}
