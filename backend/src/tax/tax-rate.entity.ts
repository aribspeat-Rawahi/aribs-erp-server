import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A configurable VAT/tax rate (e.g. "Standard VAT (Oman)" at 5%,
// "Zero-Rated" at 0%, "Exempt"). Not yet applied automatically anywhere —
// this is the reference list the upcoming auto-posting double-entry work
// (and, later, Invoice/Expense line items) will read from, so the rates
// only need entering once here.
@Entity('tax_rates')
export class TaxRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // Percentage, e.g. 5.000 for 5% VAT.
  @Column('decimal', { precision: 6, scale: 3 })
  rate: number;

  @Column({ nullable: true, type: 'text' })
  description?: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
