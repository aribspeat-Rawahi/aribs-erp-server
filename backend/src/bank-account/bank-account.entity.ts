import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BankAccountType {
  BANK = 'bank',
  CASH = 'cash',
}

@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // e.g. "Bank Muscat - Current" or "Petty Cash"
  @Column()
  name: string;

  @Column({ type: 'enum', enum: BankAccountType, default: BankAccountType.BANK })
  type: BankAccountType;

  @Column({ nullable: true })
  bankName: string;

  @Column({ nullable: true })
  accountNumber: string;

  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  openingBalance: number;

  // Kept in sync by BankAccountService whenever a transaction is
  // recorded, so reads (dashboard, list) don't need to sum transactions.
  @Column('decimal', { precision: 12, scale: 3, default: 0 })
  currentBalance: number;

  // References Account.id (Chart of Accounts) — the Asset account this
  // bank/cash account posts to whenever auto-posting double-entry needs
  // to Debit or Credit it (Expense paid from here, Reimbursement/Tax
  // Payment bank sync, Fund Transfer, Invoice payment received). Set
  // automatically on create (see BankAccountService) by linking to
  // "1000 Cash in Hand" for the first cash account or auto-creating a
  // new Account for every bank account; nullable only so a BankAccount
  // created before this feature existed can still be read (it gets
  // linked lazily, the first time auto-posting needs it).
  @Column({ nullable: true })
  journalAccountId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
