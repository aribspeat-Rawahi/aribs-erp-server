import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// One row per uploaded document for an employee — Residence ID, Passport,
// Visa, Employment Contract, or any other type the office needs to keep
// on file. `label` is free text (not a fixed enum) since the list of
// document types varies and can grow ("and many more").
@Entity('employee_documents')
export class EmployeeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Plain FK column, same pattern as AttendanceRecord.employeeId — no
  // TypeORM relation/join needed since we always look these up by
  // employeeId directly.
  @Column()
  employeeId: string;

  @Column()
  label: string;

  // Original uploaded file name (for display + a sensible download name),
  // separate from the sanitized name actually used on disk.
  @Column()
  originalName: string;

  @Column()
  filePath: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
