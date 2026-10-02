import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  CANCELED = 'canceled',
}

// A leave/absence application. `staffName` is free text for now (not
// linked to a real Employee row yet — same standalone-step approach as
// the other new HR sections). `leaves` is the day count between
// requestFrom/requestTo, computed on the frontend when those dates
// change and stored here for listing/reporting.
@Entity('hr_leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  title: string;

  @Column()
  staffName: string;

  @Column({ nullable: true })
  shortDescription: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date' })
  requestFrom: string;

  @Column({ type: 'date' })
  requestTo: string;

  @Column({ type: 'int', default: 1 })
  leaves: number;

  @Column({ type: 'enum', enum: LeaveStatus, default: LeaveStatus.PENDING })
  status: LeaveStatus;

  // Free-text name of who handled/approved this — not tied to a real
  // login account yet.
  @Column({ nullable: true })
  manageBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
