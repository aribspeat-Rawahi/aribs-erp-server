import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// HR Step-9 — standalone, like Department/Designation/Shifts/Projects/Leave
// Requests/Events: a company-wide notice/broadcast log, not linked to any
// other module yet.
@Entity('hr_notices')
export class Notice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
