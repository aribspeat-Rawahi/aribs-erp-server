import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// HR Step-10 — standalone, like Department/Designation/Shifts/Projects/
// Leave Requests/Events/Notices: a company holiday calendar, not linked to
// Attendance or any other module yet (a holiday here doesn't automatically
// mark Attendance records as "weekend"/holiday for those dates).
@Entity('hr_holidays')
export class Holiday {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'date' })
  dateFrom: string;

  @Column({ type: 'date' })
  dateTo: string;

  // Inclusive day count between dateFrom/dateTo — computed client-side
  // (same daySpan() logic as Leave Requests) and sent in, not derived here.
  @Column({ type: 'int', default: 1 })
  days: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
