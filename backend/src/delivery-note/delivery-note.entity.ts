import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Generated,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentType, DeliveryMethod } from '../common/payment-type.enum';

export enum DeliveryNoteStatus {
  DRAFT = 'draft',
  DELIVERED = 'delivered', // customer/driver has confirmed receipt
}

@Entity('delivery_notes')
export class DeliveryNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  @Column({ unique: true })
  deliveryNoteNumber: string; // e.g. DN-2026-0001

  @Column()
  customerId: string;

  @Column({ type: 'date' })
  issueDate: string;

  @Column({ type: 'date', nullable: true })
  deliveryDate: string;

  // Kept for consistency with Quotation/Invoice (same shared PDF layout
  // shows pricing), but a delivery note is about what physically went
  // out the door — pricing here is informational, not a tax document.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  subtotal: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  discountAmount: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  vatAmount: number;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  total: number;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'enum', enum: DeliveryMethod, nullable: true })
  deliveryMethod: DeliveryMethod;

  @Column({ type: 'enum', enum: DeliveryNoteStatus, default: DeliveryNoteStatus.DRAFT })
  status: DeliveryNoteStatus;

  // Set if this delivery note was generated alongside/linked to an invoice
  // or quotation from the same unified entry form.
  @Column({ nullable: true })
  invoiceNumber: string;

  @Column({ nullable: true })
  quotationNumber: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
