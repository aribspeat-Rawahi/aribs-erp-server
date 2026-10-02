import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Custom/editable job-role list for Employees (e.g. "CEO", "Store
// Manager", "Driver"). Replaces the old fixed EmployeeRole enum so the
// user can add their own roles instead of being limited to a hardcoded
// set. Seeded with the original 6 roles on first boot (see
// role.service.ts) so existing employee data keeps working.
@Entity('hr_roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}
