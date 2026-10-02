import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Employee Expense Reimbursement — an employee incurred a cost out of
// pocket (travel, meals, supplies...) and is claiming it back, as
// opposed to `Expense` (accounting/expense.entity.ts) which records the
// company's own direct expenses (rent, utilities...). Unlike Expense,
// this has its own status lifecycle: the claim itself needs sign-off
// before money moves, so approval is the primary workflow here (not a
// side-channel gate like ApprovalRequest is for invoices/quotations).
export enum ReimbursementCategory {
  TRAVEL = 'travel',
  MEALS = 'meals',
  OFFICE_SUPPLIES = 'office_supplies',
  MEDICAL = 'medical',
  OTHER = 'other',
}

export enum ReimbursementStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

@Entity('reimbursements')
export class Reimbursement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-readable reference, e.g. "RB-20260924-A1B2C3" — same generation
  // pattern as RawMaterialBatch/FinishedGoodBatch batch numbers. Shown on
  // the claim list/receipt instead of the raw UUID.
  @Column({ unique: true })
  claimNumber: string;

  // References Employee.id — no DB foreign key, same convention as
  // everywhere else in this codebase (e.g. ProductionOrder.finishedGoodId).
  // Frontend resolves the employee's name from its already-loaded
  // employee list rather than this module injecting EmployeeService.
  @Column()
  employeeId: string;

  @Column({ type: 'enum', enum: ReimbursementCategory })
  category: ReimbursementCategory;

  @Column('decimal', { precision: 12, scale: 3 })
  amount: number;

  // Date the expense was actually incurred (not the claim/decision date).
  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  // Vendor/supplier invoice or bill number this claim is against (free
  // text — same convention as Expense.invoiceNumber, not a link to our
  // own Invoice module, which only covers invoices we issue to customers).
  @Column({ nullable: true })
  invoiceNumber: string;

  // Receipt/bill scan — same upload pattern as Expense.invoiceFilePath
  // (magic-byte sniffed, saved under a fixed name derived from the
  // detected type, never trusting the client's filename/mimetype).
  @Column({ nullable: true })
  receiptFilePath: string;

  @Column({ type: 'enum', enum: ReimbursementStatus, default: ReimbursementStatus.PENDING })
  status: ReimbursementStatus;

  // Who submitted the claim (captured from the logged-in user at create
  // time — this ERP has no separate employee self-login, so claims are
  // entered by whichever staff account is handling it on the employee's
  // behalf).
  @Column({ nullable: true })
  requestedByUserId?: string;
  @Column({ nullable: true })
  requestedByEmail?: string;

  // Set by approve()/reject() — whichever happens first.
  @Column({ nullable: true })
  decidedByUserId?: string;
  @Column({ nullable: true })
  decidedByEmail?: string;
  @Column({ nullable: true })
  decidedAt?: Date;

  // Only relevant once status===REJECTED.
  @Column({ nullable: true, type: 'text' })
  rejectionReason?: string;

  // Set by markPaid(). bankAccountId/bankTransactionId are only present
  // when the payout was recorded as an automatic bank/cash withdrawal
  // (optional — paymentMethod alone covers a purely manual record, same
  // as how Expense never touches bank-account at all).
  @Column({ nullable: true })
  paymentMethod?: string;
  @Column({ nullable: true, type: 'text' })
  paymentNote?: string;
  @Column({ nullable: true })
  bankAccountId?: string;
  @Column({ nullable: true })
  bankTransactionId?: string;
  @Column({ nullable: true })
  paidAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
