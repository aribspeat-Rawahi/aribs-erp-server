import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('sales_order_items')
export class SalesOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  salesOrderId: string;

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

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @CreateDateColumn()
  createdAt: Date;
}
