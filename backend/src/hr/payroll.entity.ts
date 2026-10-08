import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// One row per employee per generated pay period. Rows are created/refreshed
// by POST /payroll/generate (which reads real Attendance records for the
// chosen date range) and then hand-edited per row (Staff Salary, Salary
// Paid By) via PATCH /payroll/:id. employeeId is kept for re-generation
// (so re-running Generate updates the same row instead of duplicating it)
// but, same as every other HR Step so far, it's not a real foreign key —
// staffName is stored as a plain snapshot string.
@Index(['employeeId'])
@Entity('hr_payroll')
export class PayrollRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  employeeId: string;

  @Column()
  staffName: string;

  @Column({ type: 'date' })
  periodFrom: string;

  @Column({ type: 'date' })
  periodTo: string;

  // All four of these are computed from real Attendance records at
  // Generate time (see PayrollService.generate) — not hand-entered.
  @Column({ type: 'int', default: 0 })
  workingDays: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0 })
  presentDays: number;

  @Column({ type: 'int', default: 0 })
  absentDays: number;

  @Column({ type: 'decimal', precision: 7, scale: 2, default: 0 })
  workingHours: number;

  // Sum of Attendance.overtimeHours for the period — computed at Generate
  // time, same as the other attendance-derived columns above.
  @Column({ type: 'decimal', precision: 7, scale: 2, default: 0 })
  otHours: number;

  // The OT rate used for this row, snapshotted at Generate time — the
  // employee's OT Rate Override (Employees tab) if set, else their
  // department's Default OT Rate (Department tab), else 0.
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  otRate: number;

  // otHours * otRate — recomputed alongside calculatedSalary whenever
  // either changes.
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  otPay: number;

  // Monthly BASIC salary used for this row (prefilled from the employee,
  // editable while the row is a draft).
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  staffSalary: number;

  // Monthly allowances (housing + transport + other) used for this row.
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  allowances: number;

  // draft -> approved (accrual journal posted) -> paid (salary paid out)
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: 'draft' | 'approved' | 'paying' | 'paid';

  // calendar days in the month / days employed in it (joiners, leavers)
  @Column({ type: 'int', default: 0 })
  periodDays: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0 })
  employedDays: number;

  // unpaid absence days (absent = 1, half day = 0.5); approved leave is paid
  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0 })
  unpaidDays: number;

  // (basic + allowances) for the days employed
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  grossPay: number;

  // unpaid days x (monthly basic + allowances) / 30
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  absenceDeduction: number;

  @Column({ default: false })
  socialProtectionCovered: boolean;

  // Social Protection Fund: employee share (deducted) and employer share
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  spfEmployee: number;

  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  spfEmployer: number;

  // salary advance installments recovered in this payroll
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  advanceRecovery: number;

  // JSON [{ advanceId, amount }] behind advanceRecovery
  @Column({ type: 'text', nullable: true })
  advanceAllocations: string | null;

  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  approvedByEmail: string | null;

  @Column({ nullable: true })
  salaryPaidBy: string;

  // Payroll "Mark Paid" — set once salary for this row has actually been
  // paid out. bankAccountId/bankTransactionId are set only when paid via
  // a real bank/cash withdrawal (same optional-bank-sync convention as
  // Reimbursement.markPaid) — blank means a record-only payment (no bank
  // movement, no auto-posted journal entry).
  @Column({ default: false })
  isPaid: boolean;
  @Column({ type: 'date', nullable: true })
  paidDate: string;
  @Column({ nullable: true })
  bankAccountId: string;
  @Column({ nullable: true })
  bankTransactionId: string;

  // Net pay = grossPay - absenceDeduction + otPay - spfEmployee - advanceRecovery
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  calculatedSalary: number;

  @CreateDateColumn()
  createdAt: Date;
}
