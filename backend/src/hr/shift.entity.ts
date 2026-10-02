import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A named work shift (e.g. "Morning", "Night", "Half Day") with its own
// start/end/late-mark times — separate from the single company-wide
// shift start/end already in Settings (used by Attendance's grace-period
// auto-calculation). This is the foundation for multiple shifts; nothing
// here is wired into Attendance yet (no Employee -> Shift assignment),
// so `startTime`/`endTime`/`lateTime` are just stored, not yet used to
// derive present/late/overtime.
@Entity('hr_shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  // The clock time after which a check-in counts as late for this
  // shift. Stored as a plain time value (not yet used by the
  // Attendance grace-period logic, which currently uses Settings'
  // single shift start/end + grace minutes).
  @Column({ type: 'time', nullable: true })
  lateTime: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
