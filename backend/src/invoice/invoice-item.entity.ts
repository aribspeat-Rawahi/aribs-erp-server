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

  @Column('decimal', { precision: 12, scale: 3 })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 2, default: 5.0 })
  vatRate: number;

  @Column('decimal', { precision: 12, scale: 3 })
  lineTotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
