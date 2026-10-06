import { Entity, PrimaryGeneratedColumn, Column, Generated, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { DeliveryMethod, PaymentType } from '../common/payment-type.enum';
import { InvoiceTemplate } from '../settings/settings.entity';

export enum QuotationStatus {
  DRAFT = 'draft',
  APPROVED = 'approved', // customer accepted
  CONVERTED = 'converted', // turned into an invoice
  EXPIRED = 'expired',
}

@Index(['customerId'])
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

  // Same fields as an invoice, so a quotation form matches the invoice
  // form and converting to an invoice carries everything over.
  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'date', nullable: true })
  deliveryDate: string;

  @Column({ type: 'enum', enum: InvoiceTemplate, default: InvoiceTemplate.CLASSIC })
  template: InvoiceTemplate;

  // No VAT on this quotation (same approval rule as an invoice).
  @Column({ default: false })
  vatExcluded: boolean;

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
