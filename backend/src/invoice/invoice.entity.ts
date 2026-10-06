import { Entity, PrimaryGeneratedColumn, Column, Generated, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { PaymentType, PaymentStatus, DeliveryMethod } from '../common/payment-type.enum';
import { InvoiceTemplate } from '../settings/settings.entity';

@Index(['customerId'])
@Index(['salesOrderId'])
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Sequential, gap-free number — required for Oman VAT audit purposes.
  // MySQL requires an auto-increment column to be indexed as a key,
  // so this is marked unique (it's not the primary key — `id` is).
  @Column({ unique: true })
  @Generated('increment')
  sequenceNumber: number;

  // Human-readable number built from sequenceNumber, e.g. INV-2026-0001.
  @Column({ unique: true })
  invoiceNumber: string;

  @Column()
  customerId: string;

  @Column({ nullable: true })
  salesOrderId: string;

  @Column({ nullable: true })
  quotationId: string; // set if this invoice came from a converted quotation

  // Human-readable quotation number shown on the invoice (e.g. QTN-2026-0001).
  // Auto-filled when converting a quotation to invoice; empty for a
  // direct invoice; can also be typed in manually either way.
  @Column({ nullable: true })
  quotationNumber: string;

  @Column({ type: 'date' })
  issueDate: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string;

  @Column({ type: 'date', nullable: true })
  deliveryDate: string;

  @Column('decimal', { precision: 12, scale: 3 })
  subtotal: number;

  // Flat discount amount (in OMR) subtracted from subtotal before VAT
  // is calculated. Feeds the standardized Gross/Discount/Taxable/VAT/Net
  // breakdown shown on every invoice template.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  discountAmount: number;

  @Column('decimal', { precision: 12, scale: 3 })
  vatAmount: number;

  @Column('decimal', { precision: 12, scale: 3 })
  total: number;

  // If true, VAT was excluded for this customer/invoice (manual override).
  // Triggers an email notice to CEO/MD/Accountant — see EmailService.
  @Column({ default: false })
  vatExcluded: boolean;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'enum', enum: DeliveryMethod, nullable: true })
  deliveryMethod: DeliveryMethod;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.DUE })
  paymentStatus: PaymentStatus;

  // Running total of everything recorded against this invoice in the
  // Payment Ledger (invoice_payments table) — kept in sync there rather
  // than summed on every read, so the Invoices list and the Accounts
  // Receivable Aging Report can use it directly without extra joins.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  paidAmount: number;

  // --- Delivery ---------------------------------------------------------
  // 'pending' until the goods reach the customer: "In Store" sales are
  // delivered at once; others when marked delivered on the Delivery Notes
  // > Not Delivered Yet page, or when their delivery note is delivered.
  @Column({ length: 20, default: 'pending' })
  deliveryStatus: string;

  @Column({ type: 'datetime', nullable: true })
  deliveredAt: Date | null;

  // how it became delivered: in_store | manual | delivery_note
  @Column({ type: 'varchar', length: 20, nullable: true })
  deliveredVia: string | null;

  // --- Stock --------------------------------------------------------------
  // Stock is taken out when the invoice is created (it may go below zero).
  // true while some of this invoice's products are still short.
  @Column({ default: false })
  waitingForStock: boolean;

  // when the missing stock arrived (a reminder email was sent then)
  @Column({ type: 'datetime', nullable: true })
  stockReadyAt: Date | null;

  // Cost of the goods currently taken out of stock for this invoice
  // (posted as Cost of Goods Sold / Finished Goods Inventory).
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  cogsAmount: number;

  // Version history: starts at 1. Editing on the SAME calendar day as
  // issueDate just re-generates the PDF at the same version (overwrite).
  // Editing on a DIFFERENT day bumps this and keeps the old PDF file.
  @Column({ default: 1 })
  version: number;

  // Which of the three designs (classic / formal / po_style) this
  // invoice was generated with. Defaults to Settings.defaultInvoiceTemplate
  // at creation time, but can be overridden per invoice.
  @Column({ type: 'enum', enum: InvoiceTemplate, default: InvoiceTemplate.CLASSIC })
  template: InvoiceTemplate;

  // Relative path to the currently-saved PDF for this version.
  @Column({ nullable: true })
  pdfPath: string;

  // Set by PaymentReminderService whenever an automatic (or manual)
  // payment reminder email goes out. Used to (a) avoid sending more than
  // one reminder per calendar day and (b) avoid re-sending the exact same
  // milestone twice (see lastReminderMilestone).
  @Column({ type: 'date', nullable: true })
  lastReminderSentAt: string;

  // Which milestone the last reminder was for, e.g. "due_soon_3",
  // "overdue_7". Compared against today's matching milestone so each one
  // fires exactly once per invoice.
  @Column({ nullable: true })
  lastReminderMilestone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
