import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { VendorPrepaymentApplication } from './vendor-prepayment-application.entity';

// An advance paid to a supplier before a bill arrives (e.g. a 50% deposit
// to secure a raw material order). Posts Dr 1310 Vendor Prepayments / Cr
// {bank} in full as soon as it's paid — an asset until later applied
// against what we owe that supplier (see VendorPrepaymentService.apply()),
// partially or across several applications over time.
@Entity('vendor_prepayments')
export class VendorPrepayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "VP-20260924-A1B2C3" — same generator
  // pattern as transferNumber/returnNumber/assetNumber.
  @Column({ unique: true })
  prepaymentNumber: string;

  @Column()
  supplierId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  // Where the advance was paid from — required, since a prepayment is by
  // definition a real cash outflow (no "record only" option, unlike
  // Expense/PurchaseReturn's optional bank leg).
  @Column()
  bankAccountId: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  // Running total applied against Accounts Payable so far — see
  // VendorPrepaymentApplication. remaining = amount - appliedAmount;
  // "outstanding" while remaining > 0, "applied" once fully used up.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  appliedAmount: number;

  @Column({ nullable: true, type: 'text' })
  note?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @OneToMany(() => VendorPrepaymentApplication, (a) => a.vendorPrepayment)
  applications: VendorPrepaymentApplication[];

  @CreateDateColumn()
  createdAt: Date;
}
