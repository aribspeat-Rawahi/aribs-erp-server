import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Custom/editable team list for Employees (e.g. "Packing Team", "Quality
// Team"), separate from Department (a free-text field on Employee).
@Entity('hr_teams')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}
