import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  HALF_DAY = 'half_day',
  LEAVE = 'leave',
  WEEKEND = 'weekend', // company-wide weekly off day (see Settings.weeklyOffDays)
}

@Index(['employeeId', 'date'])
@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time', nullable: true })
  checkIn: string;

  @Column({ type: 'time', nullable: true })
  checkOut: string;

  @Column({ type: 'time', nullable: true })
  lunchIn: string;

  @Column({ type: 'time', nullable: true })
  lunchOut: string;

  // Break duration in minutes — a plain manual number rather than
  // derived from lunchIn/lunchOut, since a break isn't always the lunch
  // window (short breaks, multiple breaks, etc.).
  @Column({ type: 'int', nullable: true })
  breakMinutes: number;

  @Column({ type: 'enum', enum: AttendanceStatus, default: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @Column({ nullable: true })
  notes: string;

  // Overtime worked on this day, in hours (e.g. 2.5). Independent of
  // status — an employee can be "present" and still log overtime.
  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  overtimeHours: number;

  // Whether this record was entered by hand or came from a fingerprint/
  // biometric device punch (POST /attendance/device-punch). Purely
  // informational — shown as a badge in the Attendance list.
  @Column({ default: 'manual' })
  source: 'manual' | 'device';

  @CreateDateColumn()
  createdAt: Date;
}
