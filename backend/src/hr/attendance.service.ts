import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { AttendanceRecord, AttendanceStatus } from './attendance.entity';
import { MarkAttendanceDto, DevicePunchDto } from './dto/hr.dto';
import { SettingsService } from '../settings/settings.service';
import { EmployeeService } from './employee.service';

// Statuses that mean "this day isn't a normal work day" — check-in/
// check-out time math shouldn't override these even if times happen to
// be present on the record (e.g. a half-day that still has a check-in).
const NON_DERIVABLE_STATUSES = new Set([
  AttendanceStatus.ABSENT,
  AttendanceStatus.LEAVE,
  AttendanceStatus.WEEKEND,
  AttendanceStatus.HALF_DAY,
]);

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private repo: Repository<AttendanceRecord>,
    private settingsService: SettingsService,
    private employeeService: EmployeeService,
  ) {}

  // The business runs on Oman time (UTC+4, no DST), but the hosting
  // server's own clock/timezone can't be assumed to match (Hostinger
  // Node processes commonly run in UTC). Computing "today" or a device
  // punch's time-of-day from a bare `new Date()` would silently use
  // whatever timezone the server happens to be in — off by 4 hours from
  // Oman wall-clock time, which would corrupt the grace-period math
  // below. So every "now" in this service goes through this instead.
  private static readonly OMAN_OFFSET_MS = 4 * 60 * 60 * 1000;

  private omanDateAndTime(at: Date): { date: string; time: string } {
    const local = new Date(at.getTime() + AttendanceService.OMAN_OFFSET_MS);
    return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 19) };
  }

  private todayStr() {
    return this.omanDateAndTime(new Date()).date;
  }

  // "08:30" / "08:30:00" -> minutes since midnight. Returns null for an
  // empty/unparseable value so callers can skip auto-calc gracefully.
  private minutesOfDay(t?: string | null): number | null {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  // Applies the company's grace-period rule to whatever check-in/
  // check-out/status the record currently has, using the shift times
  // configured in Settings. Shared by manual marking (mark()) and
  // future fingerprint device punches (punch()) so both follow the
  // exact same present/late and overtime math.
  private async applyGracePeriodRules(record: AttendanceRecord) {
    const settings = await this.settingsService.get();
    const grace = settings.attendanceGraceMinutes ?? 15;
    const shiftStart = this.minutesOfDay(settings.shiftStartTime);
    const shiftEnd = this.minutesOfDay(settings.shiftEndTime);

    // Present vs. late: only derived when we have both a check-in and a
    // configured shift start, and the record isn't already marked as a
    // non-work-day status (absent/leave/weekend/half-day) on purpose.
    if (shiftStart !== null && !NON_DERIVABLE_STATUSES.has(record.status)) {
      const checkInMinutes = this.minutesOfDay(record.checkIn);
      if (checkInMinutes !== null) {
        record.status = checkInMinutes <= shiftStart + grace ? AttendanceStatus.PRESENT : AttendanceStatus.LATE;
      }
    }

    // Overtime: within `grace` minutes past shift end counts as normal
    // (0 OT); beyond that, the FULL time past shift end counts — not
    // just the part beyond the grace window.
    if (shiftEnd !== null) {
      const checkOutMinutes = this.minutesOfDay(record.checkOut);
      if (checkOutMinutes !== null) {
        const pastShiftEnd = checkOutMinutes - shiftEnd;
        record.overtimeHours = pastShiftEnd > grace ? Math.round((pastShiftEnd / 60) * 100) / 100 : 0;
      }
    }
  }

  // One attendance record per employee per day — marking again the same
  // day updates that record instead of creating a duplicate.
  async mark(dto: MarkAttendanceDto) {
    const date = dto.date || this.todayStr();
    let record = await this.repo.findOne({ where: { employeeId: dto.employeeId, date } });

    if (record) {
      if (dto.checkIn !== undefined) record.checkIn = dto.checkIn;
      if (dto.checkOut !== undefined) record.checkOut = dto.checkOut;
      if (dto.lunchIn !== undefined) record.lunchIn = dto.lunchIn;
      if (dto.lunchOut !== undefined) record.lunchOut = dto.lunchOut;
      if (dto.breakMinutes !== undefined) record.breakMinutes = dto.breakMinutes;
      if (dto.status !== undefined) record.status = dto.status;
      if (dto.notes !== undefined) record.notes = dto.notes;
      // Manual overtime entry is kept as a fallback for when there's no
      // check-out to auto-calculate from (applyGracePeriodRules below
      // overrides this whenever a check-out + shift end time are set).
      if (dto.overtimeHours !== undefined) record.overtimeHours = dto.overtimeHours;
    } else {
      record = this.repo.create({
        employeeId: dto.employeeId,
        date,
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        lunchIn: dto.lunchIn,
        lunchOut: dto.lunchOut,
        breakMinutes: dto.breakMinutes,
        status: dto.status || AttendanceStatus.PRESENT,
        notes: dto.notes,
        overtimeHours: dto.overtimeHours,
      });
    }

    if (!record.checkIn && !record.checkOut && !dto.status) {
      throw new BadRequestException('Provide at least a check-in time or a status');
    }

    await this.applyGracePeriodRules(record);
    return this.repo.save(record);
  }

  // Called by a fingerprint/biometric device (or a bridge script
  // relaying its log) once hardware is connected. First scan of the day
  // for an employee sets check-in; the next scan sets/updates
  // check-out — so a stray extra tap just moves check-out later rather
  // than creating a second record.
  async punch(dto: DevicePunchDto) {
    const employee = await this.employeeService.findByBiometricId(dto.biometricId);
    if (!employee) throw new NotFoundException('No employee is enrolled with this Biometric ID');

    let date: string;
    let time: string;
    if (!dto.timestamp) {
      // No timestamp sent — use the server's current instant. new
      // Date()'s underlying epoch is timezone-independent, so
      // omanDateAndTime() converts it correctly regardless of the
      // server process's own local timezone setting.
      ({ date, time } = this.omanDateAndTime(new Date()));
    } else if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(dto.timestamp)) {
      // Has an explicit "Z" or +/-offset — an unambiguous UTC instant.
      const at = new Date(dto.timestamp);
      if (Number.isNaN(at.getTime())) throw new BadRequestException('Invalid timestamp');
      ({ date, time } = this.omanDateAndTime(at));
    } else {
      // Bare "YYYY-MM-DDTHH:MM[:SS]" with no zone info — assumed to
      // already be Oman wall-clock time from the device. Parsed by
      // string, not `new Date(...)`, since a bare string would
      // otherwise be silently reinterpreted in the SERVER's own local
      // timezone (a classic JS Date footgun) rather than taken literally.
      const m = dto.timestamp.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (!m) throw new BadRequestException('Invalid timestamp');
      date = m[1];
      time = `${m[2]}:${m[3]}:${m[4] || '00'}`;
    }

    let record = await this.repo.findOne({ where: { employeeId: employee.id, date } });
    if (!record) {
      record = this.repo.create({
        employeeId: employee.id,
        date,
        checkIn: time,
        status: AttendanceStatus.PRESENT,
        source: 'device',
      });
    } else if (!record.checkIn) {
      record.checkIn = time;
      record.source = 'device';
    } else {
      record.checkOut = time;
      record.source = 'device';
    }

    await this.applyGracePeriodRules(record);
    return this.repo.save(record);
  }

  findByEmployee(employeeId: string) {
    return this.repo.find({ where: { employeeId }, order: { date: 'DESC' } });
  }

  findByDate(date: string) {
    return this.repo.find({ where: { date } });
  }

  // Backs the Reports > Attendance Reports page: records for a date
  // range, optionally narrowed to one employee. Employee names aren't
  // joined here — the frontend already has the employee list loaded and
  // resolves employeeId -> name itself, same as the Attendance tab does.
  findReport(from: string, to: string, employeeId?: string) {
    const where: FindOptionsWhere<AttendanceRecord> = { date: Between(from, to) };
    if (employeeId) where.employeeId = employeeId;
    return this.repo.find({ where, order: { date: 'ASC' } });
  }

  // Removes a single attendance record — for fixing a wrong/duplicate
  // manual entry (the frontend warns before calling this).
  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Attendance record not found');
    await this.repo.remove(item);
    return { success: true };
  }
}
