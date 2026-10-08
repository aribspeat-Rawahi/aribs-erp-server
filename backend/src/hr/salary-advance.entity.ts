import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A salary advance request — an employee (or HR on their behalf) asks for
// part of their salary early. Goes through the existing generic Approval
// Workflow (see ApprovalRequestType.SALARY_ADVANCE) exactly like an
// invoice/quotation approval gate: this row is created as PENDING up
// front, a matching ApprovalRequest row is pushed into the shared queue
// so it shows on the Approvals dashboard, and approve()/reject() here
// flip this row's status once an approver decides. Disbursement (the
// actual payout) is a separate step after approval — same two-step
// shape as Payroll's Generate-then-Mark-Paid.
export enum SalaryAdvanceStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('salary_advance_requests')
export class SalaryAdvanceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Not a real FK (same convention as PayrollRecord.employeeId) —
  // employeeName is snapshotted so the record still reads fine even if
  // the employee is later archived/removed.
  @Column({ nullable: true })
  employeeId: string;

  @Column()
  employeeName: string;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  amount: number;

  // Monthly amount recovered from payroll (null = the whole remaining
  // balance from the next payroll).
  @Column({ type: 'decimal', precision: 12, scale: 3, nullable: true })
  installmentAmount: number | null;

  // Recovered so far through approved payroll rows.
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  recoveredAmount: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'enum', enum: SalaryAdvanceStatus, default: SalaryAdvanceStatus.PENDING })
  status: SalaryAdvanceStatus;

  // Links back to the row in the shared approval_requests table this
  // request rides on.
  @Column({ nullable: true })
  approvalRequestId?: string;

  @Column({ nullable: true })
  requestedByUserId?: string;

  @Column({ nullable: true })
  requestedByEmail?: string;

  @Column({ nullable: true })
  decidedByUserId?: string;

  @Column({ nullable: true })
  decidedByEmail?: string;

  @Column({ nullable: true })
  decidedAt?: Date;

  // Set only once the approved advance has actually been paid out —
  // same optional-bank-sync convention as Payroll.markPaid/Reimbursement.
  @Column({ default: false })
  disbursed: boolean;

  @Column({ type: 'date', nullable: true })
  disbursedDate?: string;

  @Column({ nullable: true })
  bankAccountId?: string;

  @Column({ nullable: true })
  bankTransactionId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
