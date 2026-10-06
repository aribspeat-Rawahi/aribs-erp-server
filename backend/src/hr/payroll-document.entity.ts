import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// A payment-proof document (bank transfer receipt, cash voucher, etc.)
// attached to a payroll row once its salary has actually been paid out.
// Mirrors EmployeeDocument's shape exactly, just keyed by payrollId
// instead of employeeId — a payroll row can have more than one document.
@Index(['payrollId'])
@Entity('payroll_documents')
export class PayrollDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  payrollId: string;

  @Column()
  label: string;

  @Column()
  originalName: string;

  @Column()
  filePath: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
