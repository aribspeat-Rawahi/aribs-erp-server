import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  phone: string; // used for the WhatsApp send button

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  address: string;

  // Commercial Registration number of the customer's business, if any.
  @Column({ nullable: true })
  crNumber: string;

  // Oman VAT registration number of the customer, if they have one.
  @Column({ nullable: true })
  vatin: string;

  // If false, this customer does not accept VAT on their invoices —
  // used by the invoice module's VAT-exclude flow.
  @Column({ default: true })
  vatApplicable: boolean;

  // Maximum total outstanding balance (unpaid invoice total minus
  // whatever's been paid so far, across every non-fully-paid invoice)
  // this customer is allowed to carry. Null/0 means no limit is
  // enforced. Checked by InvoiceService on create/update — see
  // getOutstandingBalance() there.
  @Column('decimal', { precision: 12, scale: 3, nullable: true })
  creditLimit: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
