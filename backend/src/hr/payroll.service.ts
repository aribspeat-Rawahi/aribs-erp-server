import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { PayrollRecord } from './payroll.entity';
import { AttendanceRecord, AttendanceStatus } from './attendance.entity';
import { Holiday } from './holiday.entity';
import { Department } from './department.entity';
import { EmployeeService } from './employee.service';
import { GeneratePayrollDto, UpdatePayrollDto, MarkPayrollPaidDto } from './dto/payroll.dto';
import { BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService } from '../journal/journal-posting.service';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Matches EXPENSE_CATEGORY_ACCOUNT_CODE[ExpenseCategory.SALARY] in
// accounting/expense.service.ts — the same Wages & Salaries account, so
// Payroll and a manual Expense entry both land in the same place.
const WAGES_SALARIES_CODE = '664';

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(PayrollRecord)
    private repo: Repository<PayrollRecord>,
    @InjectRepository(AttendanceRecord)
    private attendanceRepo: Repository<AttendanceRecord>,
    @InjectRepository(Holiday)
    private holidayRepo: Repository<Holiday>,
    @InjectRepository(Department)
    private departmentRepo: Repository<Department>,
    private employeeService: EmployeeService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  private hoursOf(checkIn?: string | null, checkOut?: string | null): number {
    if (!checkIn || !checkOut) return 0;
    const [ih, im] = checkIn.split(':').map(Number);
    const [oh, om] = checkOut.split(':').map(Number);
    let minutes = oh * 60 + om - (ih * 60 + im);
    if (minutes < 0) minutes += 24 * 60;
    return Math.round((minutes / 60) * 100) / 100;
  }

  private proratedBase(staffSalary: number, workingDays: number, presentDays: number): number {
    if (!workingDays) return Number(staffSalary) || 0;
    return Math.round((Number(staffSalary) * (presentDays / workingDays)) * 100) / 100;
  }

  // Net payable = attendance-prorated base salary + OT pay.
  private calcSalary(staffSalary: number, workingDays: number, presentDays: number, otPay: number): number {
    return Math.round((this.proratedBase(staffSalary, workingDays, presentDays) + Number(otPay)) * 100) / 100;
  }

  // A date counts as a company holiday if it falls within an ACTIVE
  // Holiday's [dateFrom, dateTo] range (inclusive) — string comparison is
  // safe since both sides are plain "YYYY-MM-DD".
  private isHoliday(date: string, holidays: Holiday[]): boolean {
    return holidays.some((h) => h.active && date >= h.dateFrom && date <= h.dateTo);
  }

  // Reads real Attendance records for [from, to] and creates/refreshes one
  // hr_payroll row per active employee for that exact period. Re-running
  // Generate for the same period+employee updates the computed columns in
  // place (keeping whatever Staff Salary / Salary Paid By was already
  // entered) rather than creating a duplicate row.
  async generate(dto: GeneratePayrollDto) {
    const { from, to } = dto;
    const employees = (await this.employeeService.findAll()).filter((e) => e.active);
    const employeeIds = employees.map((e) => e.id);
    const holidays = await this.holidayRepo.find();
    const departments = await this.departmentRepo.find();

    // Batch-fetch attendance and existing payroll rows for every employee
    // in one query each, instead of one query per employee per period.
    const [allAttendance, existingRows] = employeeIds.length
      ? await Promise.all([
          this.attendanceRepo.find({
            where: { employeeId: In(employeeIds), date: Between(from, to) },
          }),
          this.repo.find({
            where: { employeeId: In(employeeIds), periodFrom: from, periodTo: to },
          }),
        ])
      : [[], []];

    const attendanceByEmployee = new Map<string, AttendanceRecord[]>();
    for (const r of allAttendance) {
      const list = attendanceByEmployee.get(r.employeeId) || [];
      list.push(r);
      attendanceByEmployee.set(r.employeeId, list);
    }
    const existingRowByEmployee = new Map(existingRows.map((r) => [r.employeeId, r]));

    const rowsToSave: PayrollRecord[] = [];
    for (const emp of employees) {
      const allRecords = attendanceByEmployee.get(emp.id) || [];
      // Same treatment as a weekly-off day: a date inside a scheduled
      // Holiday doesn't count toward working/absent days, even if an
      // attendance record exists for it.
      const records = allRecords.filter((r) => !this.isHoliday(r.date, holidays));

      const workingDays = records.filter((r) => r.status !== AttendanceStatus.WEEKEND).length;
      const presentDays = records.reduce((sum, r) => {
        if (r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE) return sum + 1;
        if (r.status === AttendanceStatus.HALF_DAY) return sum + 0.5;
        return sum;
      }, 0);
      const absentDays = records.filter((r) => r.status === AttendanceStatus.ABSENT).length;
      const workingHours = Math.round(
        records.reduce((sum, r) => sum + this.hoursOf(r.checkIn, r.checkOut), 0) * 100,
      ) / 100;
      const otHours = Math.round(records.reduce((sum, r) => sum + (Number(r.overtimeHours) || 0), 0) * 100) / 100;

      // Effective OT rate: the employee's own override if set, else
      // their department's Default OT Rate, else 0 — same resolution
      // order as Reports > Attendance Reports' Salary Status card.
      const departmentRate = departments.find((d) => d.name === emp.department)?.otRatePerHour;
      const otRate = emp.otRatePerHour != null ? Number(emp.otRatePerHour) : Number(departmentRate) || 0;
      const otPay = Math.round(otHours * otRate * 100) / 100;

      let row = existingRowByEmployee.get(emp.id);
      if (!row) {
        row = this.repo.create({
          employeeId: emp.id,
          staffName: emp.name,
          periodFrom: from,
          periodTo: to,
          // Prefill from the employee's Base Salary (set on the Employees
          // tab) so this doesn't have to be typed in by hand every time —
          // still fully editable afterwards.
          staffSalary: Number(emp.baseSalary) || 0,
        });
      } else {
        // Name may have changed since the row was first generated —
        // keep the snapshot current.
        row.staffName = emp.name;
      }
      row.workingDays = workingDays;
      row.presentDays = presentDays;
      row.absentDays = absentDays;
      row.workingHours = workingHours;
      row.otHours = otHours;
      row.otRate = otRate;
      row.otPay = otPay;
      row.calculatedSalary = this.calcSalary(row.staffSalary, workingDays, presentDays, otPay);
      rowsToSave.push(row);
    }

    if (rowsToSave.length) await this.repo.save(rowsToSave);

    return this.repo.find({
      where: { periodFrom: from, periodTo: to },
      order: { staffName: 'ASC' },
    });
  }

  async update(id: string, dto: UpdatePayrollDto) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Payroll record not found');
    if (row.isPaid && dto.staffSalary !== undefined && Number(dto.staffSalary) !== Number(row.staffSalary)) {
      throw new BadRequestException('This row is already marked paid — the salary amount can no longer be changed.');
    }
    if (dto.staffSalary !== undefined) row.staffSalary = dto.staffSalary;
    if (dto.salaryPaidBy !== undefined) row.salaryPaidBy = dto.salaryPaidBy;
    row.calculatedSalary = this.calcSalary(row.staffSalary, row.workingDays, row.presentDays, row.otPay);
    return this.repo.save(row);
  }

  async remove(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Payroll record not found');
    if (row.isPaid) {
      throw new BadRequestException('This row is already marked paid — kept for the audit trail, not deletable.');
    }
    await this.repo.remove(row);
    return { success: true };
  }

  // Payroll "Mark Paid" — the one place salary actually leaves the
  // business. If dto.bankAccountId is set, records a real withdrawal on
  // that account (same optional-bank-sync as Reimbursement.markPaid) and
  // auto-posts Dr 664 Wages & Salaries / Cr {account}. Best-effort: the
  // payout itself already succeeded, so a posting failure is logged
  // rather than surfaced as an error here.
  async markPaid(id: string, dto: MarkPayrollPaidDto, actor: ActorRef = {}) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Payroll record not found');
    if (row.isPaid) {
      throw new BadRequestException('This payroll row is already marked paid.');
    }

    if (dto.bankAccountId) {
      const txn = await this.bankAccountService.addTransaction(dto.bankAccountId, {
        type: BankTransactionType.WITHDRAWAL,
        amount: Number(row.calculatedSalary),
        date: new Date().toISOString().slice(0, 10),
        note: `Salary — ${row.staffName} (${row.periodFrom} to ${row.periodTo})`,
      });
      row.bankAccountId = dto.bankAccountId;
      row.bankTransactionId = txn.id;
    }

    await this.journalPosting.assertDateOpen(new Date().toISOString().slice(0, 10), 'Paying salary today');
    row.isPaid = true;
    row.paidDate = new Date().toISOString().slice(0, 10);
    const saved = await this.repo.save(row);

    if (saved.bankAccountId) {
      try {
        const expenseAccountId = await this.journalPosting.findAccountIdByCode(WAGES_SALARIES_CODE);
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        await this.journalPosting.postForSource(
          'payroll',
          saved.id,
          saved.paidDate,
          `Salary — ${saved.staffName} (${saved.periodFrom} to ${saved.periodTo})`,
          [
            { accountId: expenseAccountId, debit: Number(saved.calculatedSalary), description: 'Wages & Salaries' },
            { accountId: bankJournalAccountId, credit: Number(saved.calculatedSalary), description: 'Salary payout' },
          ],
          actor,
          saved.staffName,
        );
      } catch (err) {
        console.error(`Auto-posting failed for payroll ${saved.id}:`, err);
      }
    }

    return saved;
  }
}
