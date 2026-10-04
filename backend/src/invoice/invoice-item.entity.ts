import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  invoiceId: string;

  @Column({ nullable: true })
  finishedGoodId: string;

  @Column()
  description: string;

  @Column('decimal', { precision: 12, scale: 3 })
  quantity: number;

  // pcs | bags | kg | litre | ton (see units/units.ts) - copied from the
  // product when the line is saved, so old documents keep their unit.
  @Column({ length: 10, default: 'pcs' })
  unit: string;

  // How much of this line was missing from stock when the invoice was
  // saved (kept as a record; the live shortage is recalculated).
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  shortQuantity: number;

  @Column('decimal', { precision: 12, scale: 3 })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @Column('decimal', { precision: 12, scale: 3 })
  lineTotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
