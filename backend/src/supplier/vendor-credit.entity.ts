import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { VendorCreditApplication } from './vendor-credit-application.entity';
import { VendorCreditRefund } from './vendor-credit-refund.entity';

// A credit note issued by a supplier that isn't tied to a specific
// PurchaseReturn (a goodwill credit, a price adjustment, a volume rebate,
// etc — for a credit that DOES come from returned goods, see
// PurchaseReturn instead). Posts Dr 2000 Accounts Payable / Cr 1408
// Purchase Return in full as soon as it's issued, since it reduces what
// we owe the supplier immediately; applying it later against a specific
// bill (apply()) is then just bookkeeping with no further ledger effect,
// and only refund() — receiving actual cash back instead — posts a
// further entry. See VendorCreditService for the full accounting.
@Entity('vendor_credits')
export class VendorCredit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "VC-20260924-A1B2C3".
  @Column({ unique: true })
  creditNumber: string;

  @Column()
  supplierId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true, type: 'text' })
  reason?: string;

  // Running totals — remaining = amount - appliedAmount - refundedAmount.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  appliedAmount: number;
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  refundedAmount: number;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @OneToMany(() => VendorCreditApplication, (a) => a.vendorCredit)
  applications: VendorCreditApplication[];

  @OneToMany(() => VendorCreditRefund, (r) => r.vendorCredit)
  refunds: VendorCreditRefund[];

  @CreateDateColumn()
  createdAt: Date;
}
