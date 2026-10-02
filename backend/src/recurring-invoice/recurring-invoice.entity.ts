import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PaymentType, DeliveryMethod } from '../common/payment-type.enum';
import { InvoiceTemplate } from '../settings/settings.entity';

// CRM Step 8 — Recurring Invoice. A saved "template" for an invoice that
// repeats on a schedule (rent, a subscription, a retainer, ...) — a
// daily cron job (RecurringInvoiceService) generates a real Invoice via
// InvoiceService.create() whenever nextRunDate is reached, then rolls
// nextRunDate forward by `frequency`. It goes through the exact same
// approval gates (credit limit / large discount / VAT exclude) as a
// manually created invoice — see RecurringInvoiceService.generateInvoiceFor().
export enum RecurringFrequency {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

@Entity('recurring_invoices')
export class RecurringInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  // A short label so the list is readable ("Warehouse rent", "Monthly
  // retainer — Acme LLC") — purely for display, never printed on the
  // generated invoice itself.
  @Column()
  label: string;

  // Same item shape as InvoiceItemDto, stored as JSON (a recurring
  // invoice's line items don't need their own relational table — they're
  // just replayed into a real Invoice each time, never queried on their
  // own).
  @Column({ type: 'text' })
  items: string;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  discountAmount: number;

  @Column({ type: 'enum', enum: PaymentType, nullable: true })
  paymentType: PaymentType;

  @Column({ type: 'enum', enum: DeliveryMethod, nullable: true })
  deliveryMethod: DeliveryMethod;

  @Column({ type: 'enum', enum: InvoiceTemplate, nullable: true })
  template: InvoiceTemplate;

  // Left null = inherit from the customer's own vatApplicable, same as a
  // manually created invoice with no explicit override.
  @Column({ nullable: true })
  vatExcluded: boolean;

  // Each generated invoice's dueDate = its issueDate + dueDays (blank =
  // no due date, same as a manual invoice).
  @Column({ nullable: true })
  dueDays: number;

  @Column({ type: 'enum', enum: RecurringFrequency })
  frequency: RecurringFrequency;

  @Column({ type: 'date' })
  startDate: string;

  // The next date this will fire — advanced by `frequency` after every
  // successful generation (including a manual "Generate Now").
  @Column({ type: 'date' })
  nextRunDate: string;

  // Blank = runs indefinitely. Once nextRunDate would land past this,
  // `active` is set false instead of generating again.
  @Column({ type: 'date', nullable: true })
  endDate: string;

  @Column({ default: true })
  active: boolean;

  @Column({ nullable: true })
  lastGeneratedInvoiceId: string;

  @Column({ type: 'date', nullable: true })
  lastRunAt: string;

  @Column({ nullable: true })
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
