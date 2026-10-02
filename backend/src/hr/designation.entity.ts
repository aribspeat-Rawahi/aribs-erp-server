import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Job title / designation (e.g. "Production Supervisor", "Lab
// Technician"). `department` stores the department's NAME (not a
// foreign key id) — same loose-coupling pattern as Employee.role/team,
// which also reference the managed Role/Team lists by name. `color` is
// a hex string used as a small colored tag in the list UI.
@Entity('hr_designations')
export class Designation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  department: string;

  @Column({ default: '#4f46e5' })
  color: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
