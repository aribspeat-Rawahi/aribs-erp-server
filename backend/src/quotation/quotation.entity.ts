import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Generated,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryMethod } from '../common/payment-type.enum';

export enum QuotationStatus {
  DRAFT = 'draft',
  APPROVED = 'approved', // customer accepted
  CONVERTED = 'converted', // turned into an invoice
  EXPIRED = 'expired',
}

@Entity('quotations')
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // MySQL requires an auto-increment column to be indexed as a key,
  // so this is marked unique (it's not the primary key — `id` is).
  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  @Column({ unique: true })
  quotationNumber: string;

  @Column()
  customerId: string;

  @Column({ type: 'date' })
  issueDate: string;

  @Column({ type: 'date', nullable: true })
  validUntil: string;

  @Column('decimal', { precision: 12, scale: 3 })
  subtotal: number;

  // Not shown as a "Payment Terms" field on quotations (only invoices/
  // delivery notes have that) — but a proposed discount is still useful
  // pre-sale, so it lives here.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  discountAmount: number;

  @Column({ type: 'enum', enum: DeliveryMethod, nullable: true })
  deliveryMethod: DeliveryMethod;

  @Column('decimal', { precision: 12, scale: 3 })
  vatAmount: number;

  @Column('decimal', { precision: 12, scale: 3 })
  total: number;

  @Column({ type: 'enum', enum: QuotationStatus, default: QuotationStatus.DRAFT })
  status: QuotationStatus;

  // Set once this quotation is converted, linking to the resulting invoice.
  @Column({ nullable: true })
  invoiceId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
