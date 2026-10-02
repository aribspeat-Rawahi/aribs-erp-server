import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { VendorPrepayment } from './vendor-prepayment.entity';

// One "use" of a Vendor Prepayment against what we owe the supplier — its
// own row (rather than a single running total on VendorPrepayment) so
// each application has a unique id to auto-post its own Journal Entry
// against (Dr 2000 Accounts Payable / Cr 1310 Vendor Prepayments), and so
// the prepayment's full application history stays visible.
@Entity('vendor_prepayment_applications')
export class VendorPrepaymentApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  vendorPrepaymentId: string;

  @ManyToOne(() => VendorPrepayment, (p) => p.applications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendorPrepaymentId' })
  vendorPrepayment: VendorPrepayment;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  // Optional — which purchase order this application offsets, purely for
  // reference (no DB foreign key, same convention used throughout).
  @Column({ nullable: true })
  purchaseOrderId?: string;

  @Column({ nullable: true, type: 'text' })
  note?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
