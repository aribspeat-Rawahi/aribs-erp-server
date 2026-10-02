import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { VendorCredit } from './vendor-credit.entity';

// Tracking-only — recorded so it's visible which bill/PO a credit was
// used to offset, but posts no Journal Entry of its own: the credit
// already reduced Accounts Payable in full when it was created (see
// VendorCredit's own doc comment).
@Entity('vendor_credit_applications')
export class VendorCreditApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  vendorCreditId: string;

  @ManyToOne(() => VendorCredit, (c) => c.applications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendorCreditId' })
  vendorCredit: VendorCredit;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

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
