import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Most transfers clear instantly (COMPLETED, the default). IN_TRANSIT is
// an optional flag the user sets at creation for a transfer that takes
// real time to clear (e.g. an inter-bank transfer) — the source account
// is debited immediately but the destination account isn't credited
// until someone confirms it with FundTransferService.clear().
export enum FundTransferStatus {
  COMPLETED = 'completed',
  IN_TRANSIT = 'in_transit',
}

// A single "move money from one of our own accounts to another" record —
// e.g. depositing Petty Cash into the bank, or moving funds between two
// bank accounts. Distinct from BankTransaction (a plain deposit/withdrawal
// against ONE account): a transfer always touches exactly two accounts
// together, so it gets its own reference number, optional supporting
// document, and full edit/delete — see FundTransferService, which keeps
// this in sync with the two BankTransaction rows it creates on each
// account (fromTransactionId/toTransactionId) so "View transactions" on
// either account still shows the transfer.
@Entity('fund_transfers')
export class FundTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "TR-20260924-A1B2C3" — same generator
  // pattern as claimNumber/entryNumber/batchNumber.
  @Column({ unique: true })
  transferNumber: string;

  // References BankAccount.id — no DB foreign key, same convention used
  // throughout this codebase.
  @Column()
  fromAccountId: string;

  @Column()
  toAccountId: string;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true, type: 'text' })
  note?: string;

  @Column({ type: 'enum', enum: FundTransferStatus, default: FundTransferStatus.COMPLETED })
  status: FundTransferStatus;

  // Set only when a transfer created IN_TRANSIT is later confirmed
  // received via FundTransferService.clear().
  @Column({ type: 'date', nullable: true })
  clearedDate?: string;

  // Supporting document (transfer slip, bank confirmation, etc.) — same
  // magic-byte-verified upload pattern as Expense/Reimbursement.
  @Column({ nullable: true })
  documentFilePath?: string;

  // The two BankTransaction rows this transfer created (a WITHDRAWAL on
  // fromAccount, a DEPOSIT on toAccount) — kept so edit/delete can find
  // and precisely reverse them. toTransactionId is null while
  // status === IN_TRANSIT (the destination account hasn't been touched
  // yet); it's set once FundTransferService.clear() runs. A COMPLETED
  // transfer (the normal case) always has both set.
  @Column({ nullable: true })
  fromTransactionId?: string;
  @Column({ nullable: true })
  toTransactionId?: string;

  @Column({ nullable: true })
  createdByUserId?: string;
  @Column({ nullable: true })
  createdByEmail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
