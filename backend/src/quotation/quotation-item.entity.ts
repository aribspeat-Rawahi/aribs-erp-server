import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('quotation_items')
export class QuotationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  quotationId: string;

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

  // Manually adjustable — a quotation price does not have to match the
  // product's default selling price (bulk discounts, negotiation, etc.)
  @Column('decimal', { precision: 12, scale: 3 })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @Column('decimal', { precision: 12, scale: 3 })
  lineTotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
