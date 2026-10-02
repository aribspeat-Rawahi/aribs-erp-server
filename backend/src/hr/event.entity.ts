import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// HR Step-8 — standalone, like Department/Designation/Shifts/Projects/Leave
// Requests: a simple company-events log, not linked to Attendance or any
// other module yet.
@Entity('hr_events')
export class HrEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'date' })
  date: string;

  // Plain text, not a `time` column — the reference design shows a
  // free-form "9:00 PM" style label rather than a strict HH:MM value.
  @Column({ nullable: true })
  time: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
