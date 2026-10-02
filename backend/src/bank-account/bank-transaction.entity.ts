import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { BankTransactionCategory } from './bank-transaction-category.enum';

export enum BankTransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

@Entity('bank_transactions')
export class BankTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  bankAccountId: string;

  @Column({ type: 'enum', enum: BankTransactionType })
  type: BankTransactionType;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  note: string;

  // Set only when this transaction was entered through the "Add
  // Transaction" modal with a category picked — that's what makes it
  // auto-post a Journal Entry (see BankAccountService.addTransaction()).
  // Blank for transactions recorded internally by another module
  // (Expense/Reimbursement/Payroll/etc. already post their own entry) or
  // for a transaction entered before this feature existed.
  @Column({ type: 'enum', enum: BankTransactionCategory, nullable: true })
  category?: BankTransactionCategory;

  @CreateDateColumn()
  createdAt: Date;
}
