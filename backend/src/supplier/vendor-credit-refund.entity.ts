import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { VendorCredit } from './vendor-credit.entity';

// A supplier paying us actual cash back for (part of) a credit instead of
// us using it against a future bill — see VendorCreditService.refund()
// for why this posts Dr {bank} / Cr 2000 Accounts Payable.
@Entity('vendor_credit_refunds')
export class VendorCreditRefund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  vendorCreditId: string;

  @ManyToOne(() => VendorCredit, (c) => c.refunds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendorCreditId' })
  vendorCredit: VendorCredit;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column()
  bankAccountId: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
