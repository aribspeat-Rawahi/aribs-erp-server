import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ExpenseCategory {
  RENT = 'rent',
  UTILITIES = 'utilities',
  SALARY = 'salary',
  RAW_MATERIAL = 'raw_material', // manual entries not already covered by Purchase Orders
  MAINTENANCE = 'maintenance',
  TRANSPORT = 'transport',
  OTHER = 'other',
}

@Index(['date'])
@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ExpenseCategory })
  category: ExpenseCategory;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  vendorName: string;

  @Column({ nullable: true })
  invoiceNumber: string;

  // Absolute/relative path on disk to the uploaded invoice scan (PDF or
  // image). Set via POST /expenses/:id/invoice, served via GET of the
  // same route. Null until an invoice file has been uploaded.
  @Column({ nullable: true })
  invoiceFilePath: string;

  // References BankAccount.id — which cash/bank account this expense was
  // actually paid from. Optional: leaving it blank keeps this a
  // record-only expense (no bank movement, no auto-posted journal
  // entry), same as how a manual-only Reimbursement never touches
  // bank-account. When set, ExpenseService records a real withdrawal
  // (bankTransactionId below) and auto-posts Dr {category's mapped
  // expense account} / Cr {this account's linked Chart-of-Accounts
  // account} — see journal/journal-posting.service.ts.
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
