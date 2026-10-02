import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // Free-text now (was a fixed enum) — matches a name in the hr_roles
  // table (see role.entity.ts), managed from the Employees tab's
  // "Manage roles" option so custom roles can be added.
  @Column()
  role: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  // Company-issued staff/employee ID, e.g. "EMP-001". Free text, not
  // auto-generated, since different companies number these differently.
  @Column({ nullable: true })
  staffId: string;

  // Free-text department (e.g. "Production", "Sales") — separate from
  // Team, which is a managed/custom list (see team.entity.ts).
  @Column({ nullable: true })
  department: string;

  // Matches a name in the hr_teams table, managed from the Employees
  // tab's "Manage teams" option.
  @Column({ nullable: true })
  team: string;

  // Matches a name in the hr_shifts table (see shift.entity.ts) — which
  // shift this employee is assigned to. Used to compute the real "Staffs"
  // count shown on the Shifts tab.
  @Column({ nullable: true })
  shift: string;

  // Base salary for a full pay period, entered here so Payroll > Generate
  // can prefill "Staff Salary" automatically instead of starting at 0.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  baseSalary: number;

  // Optional per-employee overtime rate (currency per hour). When unset,
  // the employee's department's Department.otRatePerHour is used instead
  // (see Reports > Attendance Reports' Salary Status card).
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  otRatePerHour: number;

  // The ID/template reference a fingerprint/biometric device enrolls
  // this employee under. Set once the device is in place; used by
  // POST /attendance/device-punch to resolve a scan to an employee.
  @Column({ nullable: true, unique: true })
  biometricId: string;

  // Path to the uploaded profile photo (PNG/JPG). Served through a
  // protected route (GET /employees/:id/photo), not public — same
  // reasoning as the documents below.
  @Column({ nullable: true })
  photoPath: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'date', nullable: true })
  joinedDate: string;

  // Temporary vs Permanent staff — free-text (not a DB enum) so it stays
  // easy to extend later without a migration.
  @Column({ default: 'permanent' })
  employmentType: string;

  // Working / Terminated / Others. Kept separate from `active` (which
  // Payroll/Shift-staff-count logic already reads) — the service keeps
  // `active` in sync whenever `status` changes: Terminated -> inactive,
  // Working/Others -> active.
  @Column({ default: 'working' })
  status: string;

  // Set when this employee has been removed from the active Employees
  // list via "Delete" but kept on file instead of hard-deleted — 'old'
  // (worked 15+ days, was paid) or 'temporary' (worked under 15 days, or
  // was paid only briefly). null means still a normal, non-archived
  // employee. See EmployeeService.archive()/restore().
  @Column({ type: 'varchar', nullable: true })
  archiveType: 'old' | 'temporary' | null;

  @Column({ type: 'timestamp', nullable: true })
  archivedAt: Date | null;

  // --- "Others Detail" section — a collapsible block on the Add/Edit
  // Employee form. Every field below is optional; the office fills in
  // whatever it has on hand. ---
  @Column({ nullable: true })
  fatherName: string;

  @Column({ nullable: true })
  motherName: string;

  @Column({ type: 'date', nullable: true })
  birthDate: string;

  @Column({ nullable: true })
  passportNumber: string;

  // ISO 3166-1 alpha-2 country code (e.g. "BD"), chosen from a dropdown on
  // the frontend — used to render the origin-country flag next to the
  // employee's name on the Dashboard and in Employee details.
  @Column({ nullable: true })
  nationality: string;

  // National ID number issued by the employee's origin country.
  @Column({ nullable: true })
  originCountryIdNumber: string;

  @Column({ type: 'text', nullable: true })
  homeAddress: string;

  @Column({ type: 'text', nullable: true })
  educationalQualifications: string;

  @Column({ type: 'text', nullable: true })
  skills: string;

  @Column({ type: 'text', nullable: true })
  certifications: string;

  @Column({ nullable: true })
  guardianName: string;

  @Column({ nullable: true })
  guardianPhone: string;

  @Column({ nullable: true })
  guardianNationalId: string;

  @Column({ nullable: true })
  guardianRelationship: string;

  @Column({ type: 'text', nullable: true })
  guardianAddress: string;

  @Column({ nullable: true })
  emergencyPhone1: string;

  @Column({ nullable: true })
  emergencyPhone2: string;

  // Path to the uploaded guardian photo (PNG/JPG). Served through a
  // protected route, same reasoning as `photoPath` above.
  @Column({ nullable: true })
  guardianPhotoPath: string;

  @Column({ nullable: true })
  nomineeName: string;

  // National ID or Birth Certificate number, whichever the office has.
  @Column({ nullable: true })
  nomineeNationalId: string;

  @Column({ nullable: true })
  nomineePhone: string;

  @Column({ nullable: true })
  nomineeRelationship: string;

  @Column({ nullable: true })
  nomineePhotoPath: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
