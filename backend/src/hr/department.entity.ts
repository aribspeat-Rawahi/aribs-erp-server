import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Managed department list (e.g. "Production", "Sales", "Marketing").
// Kept separate from Employee.department, which is still a free-text
// field for now — the Employees form isn't wired to this list yet.
@Entity('hr_departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  // Default overtime rate (currency per hour) for everyone in this
  // department — an individual employee can override it via
  // Employee.otRatePerHour (see employee.entity.ts).
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  otRatePerHour: number;

  @CreateDateColumn()
  createdAt: Date;
}
