import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Chart of Accounts — the fixed list of "buckets" every Journal Entry
// line posts a Debit or Credit against (Cash, Sales Revenue, Rent
// Expense, ...). Standard double-entry account types below; `normalBalance`
// is derived from `type` (Asset/Expense accounts increase with a Debit,
// Liability/Equity/Revenue accounts increase with a Credit) and used by
// the Trial Balance report to present each account's balance on its
// natural side.
export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Short account code, e.g. "1000" (Cash), "4000" (Sales Revenue) —
  // unique, shown alongside the name everywhere in the Journals UI.
  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: AccountType })
  type: AccountType;

  @Column({ nullable: true, type: 'text' })
  description?: string;

  // Soft-disable instead of delete — a retired account may still be
  // referenced by historical Journal Entry lines.
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
