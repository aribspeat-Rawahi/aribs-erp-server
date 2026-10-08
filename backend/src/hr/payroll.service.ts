import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';
import { PayrollRecord } from './payroll.entity';
import { AttendanceRecord, AttendanceStatus } from './attendance.entity';
import { Holiday } from './holiday.entity';
import { Department } from './department.entity';
import { Employee } from './employee.entity';
import { SalaryAdvanceRequest } from './salary-advance.entity';
import { Settings } from '../settings/settings.entity';
import { EmployeeService } from './employee.service';
import { GeneratePayrollDto, UpdatePayrollDto, MarkPayrollPaidDto, ApprovePayrollDto } from './dto/payroll.dto';
import { BankTransactionType } from '../bank-account/bank-transaction.entity';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { omanToday } from '../common/oman-date';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Chart of accounts (journal/account.service.ts)
const WAGES_SALARIES_CODE = '664';
const SPF_EMPLOYER_EXPENSE_CODE = '719';
const SALARIES_PAYABLE_CODE = '2200';
const SPF_PAYABLE_CODE = '2170';
const SALARY_ADVANCE_CODE = '1320';

// Oman practice: a day's wage = monthly wage / 30
const DAYS_PER_MONTH_FOR_DAILY_RATE = 30;

const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;

function daysInclusive(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

function lastDayOfMonth(date: string): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(d).padStart(2, '0')}`;
}

interface AdvanceAllocation {
  advanceId: string;
  amount: number;
}

// Payroll by month, Oman rules:
//   gross     = (basic + allowances) for the days employed in the month
//   absence   = unpaid days (absent 1, half day 0.5) x monthly wage / 30;
//               approved leave and days without attendance are paid
//   + overtime
//   - Social Protection Fund employee share (covered staff only)
//   - salary advance installments
//   = net pay
// Generate -> draft rows; Approve posts the accrual (Dr wages + employer
// SPF / Cr salaries payable, SPF payable, advances); Mark paid posts
// Dr salaries payable / Cr bank. Approved/paid rows are never recalculated.
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
    @InjectRepository(SalaryAdvanceRequest)
    private advanceRepo: Repository<SalaryAdvanceRequest>,
    @InjectDataSource() private dataSource: DataSource,
    private employeeService: EmployeeService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
  ) {}

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  private async settings(): Promise<Settings> {
    const s = await this.dataSource.getRepository(Settings).findOne({ where: { id: 1 } });
    return s || ({ spfEmployeeRatePercent: 8, spfEmployerRatePercent: 13.5, spfWageCeiling: 3000 } as Settings);
  }

  private hoursOf(checkIn?: string | null, checkOut?: string | null): number {
    if (!checkIn || !checkOut) return 0;
    const [ih, im] = checkIn.split(':').map(Number);
    const [oh, om] = checkOut.split(':').map(Number);
    let minutes = oh * 60 + om - (ih * 60 + im);
    if (minutes < 0) minutes += 24 * 60;
    return Math.round((minutes / 60) * 100) / 100;
  }

  private isHoliday(date: string, holidays: Holiday[]): boolean {
    return holidays.some((h) => h.active && date >= h.dateFrom && date <= h.dateTo);
  }

  private allowancesOf(emp: Employee) {
    return r3(Number(emp.housingAllowance || 0) + Number(emp.transportAllowance || 0) + Number(emp.otherAllowance || 0));
  }

  // Pay periods are calendar months: one payroll per employee per month.
  private assertMonth(from: string, to: string) {
    if (!/^\d{4}-\d{2}-01$/.test(from) || to !== lastDayOfMonth(from)) {
      throw new BadRequestException('Payroll runs for one calendar month: from the 1st to the last day of the same month.');
    }
  }

  // Everything except the advance recovery, from the row's own inputs.
  private computeAmounts(row: PayrollRecord, s: Settings) {
    const monthly = r3(Number(row.staffSalary || 0) + Number(row.allowances || 0));
    const gross = row.periodDays && Number(row.employedDays) < row.periodDays ? r3((monthly * Number(row.employedDays)) / row.periodDays) : monthly;
    const absence = Math.min(gross, r3((monthly / DAYS_PER_MONTH_FOR_DAILY_RATE) * Number(row.unpaidDays || 0)));
    const earned = r3(gross - absence);
    let spfEmployee = 0;
    let spfEmployer = 0;
    if (row.socialProtectionCovered) {
      const base = Math.min(earned, Number(s.spfWageCeiling || 0) || earned);
      spfEmployee = r3((base * Number(s.spfEmployeeRatePercent || 0)) / 100);
      spfEmployer = r3((base * Number(s.spfEmployerRatePercent || 0)) / 100);
    }
    row.grossPay = gross;
    row.absenceDeduction = absence;
    row.spfEmployee = spfEmployee;
    row.spfEmployer = spfEmployer;
    return r3(earned + Number(row.otPay || 0) - spfEmployee); // pay before advance recovery
  }

  // Outstanding disbursed advances, oldest first: each gives its monthly
  // installment (or its whole remaining balance), up to what the pay allows.
  private async allocateAdvances(employeeId: string, cap: number, manager?: EntityManager): Promise<AdvanceAllocation[]> {
    const repo = manager ? manager.getRepository(SalaryAdvanceRequest) : this.advanceRepo;
    const advances = await repo.find({
      where: { employeeId, disbursed: true },
      order: { disbursedDate: 'ASC', createdAt: 'ASC' },
      ...(manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const out: AdvanceAllocation[] = [];
    let left = Math.max(0, r3(cap));
    for (const a of advances) {
      if (left <= 0) break;
      const remaining = r3(Number(a.amount) - Number(a.recoveredAmount || 0));
      if (remaining <= 0) continue;
      const want = a.installmentAmount ? Math.min(Number(a.installmentAmount), remaining) : remaining;
      const take = r3(Math.min(want, left));
      if (take <= 0) continue;
      out.push({ advanceId: a.id, amount: take });
      left = r3(left - take);
    }
    return out;
  }

  private applyAdvance(row: PayrollRecord, payable: number, alloc: AdvanceAllocation[]) {
    row.advanceRecovery = r3(alloc.reduce((s, a) => s + a.amount, 0));
    row.advanceAllocations = alloc.length ? JSON.stringify(alloc) : null;
    row.calculatedSalary = r3(payable - row.advanceRecovery);
  }

  // Creates/refreshes the month's DRAFT rows for everyone employed in it.
  // Approved and paid rows are left exactly as they are.
  async generate(dto: GeneratePayrollDto) {
    const { from, to } = dto;
    this.assertMonth(from, to);
    const s = await this.settings();
    const periodDays = daysInclusive(from, to);

    // employed at any point in the month (joined on/before its end, not left before its start)
    const employees = (await this.employeeService.findAll()).filter(
      (e) => (!e.joinedDate || e.joinedDate <= to) && (!e.leftDate ? e.active : e.leftDate >= from),
    );
    const employeeIds = employees.map((e) => e.id);
    const holidays = await this.holidayRepo.find();
    const departments = await this.departmentRepo.find();

    if (employeeIds.length) {
      // another payroll overlapping this month (old free-form periods)
      const overlapping = await this.repo
        .createQueryBuilder('p')
        .where('p.employeeId IN (:...ids)', { ids: employeeIds })
        .andWhere('p.periodFrom <= :to AND p.periodTo >= :from', { from, to })
        .andWhere('NOT (p.periodFrom = :from AND p.periodTo = :to)', { from, to })
        .getMany();
      if (overlapping.length) {
        const names = [...new Set(overlapping.map((o) => o.staffName))].join(', ');
        throw new BadRequestException(`These staff already have a payroll overlapping this month (${names}). Delete or check those rows first.`);
      }
    }

    const [allAttendance, existingRows] = employeeIds.length
      ? await Promise.all([
          this.attendanceRepo.find({ where: { employeeId: In(employeeIds), date: Between(from, to) } }),
          this.repo.find({ where: { employeeId: In(employeeIds), periodFrom: from, periodTo: to } }),
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
      let row = existingRowByEmployee.get(emp.id);
      if (row && row.status !== 'draft') continue; // approved / paid: frozen

      const start = emp.joinedDate && emp.joinedDate > from ? emp.joinedDate : from;
      const end = emp.leftDate && emp.leftDate < to ? emp.leftDate : to;
      const employedDays = start <= end ? daysInclusive(start, end) : 0;
      if (employedDays <= 0) continue;

      const records = (attendanceByEmployee.get(emp.id) || []).filter(
        (r) => r.date >= start && r.date <= end && !this.isHoliday(r.date, holidays),
      );
      const workingDays = records.filter((r) => r.status !== AttendanceStatus.WEEKEND).length;
      const presentDays = records.reduce((sum, r) => {
        if (r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE) return sum + 1;
        if (r.status === AttendanceStatus.HALF_DAY) return sum + 0.5;
        return sum;
      }, 0);
      const absentDays = records.filter((r) => r.status === AttendanceStatus.ABSENT).length;
      const halfDays = records.filter((r) => r.status === AttendanceStatus.HALF_DAY).length;
      const workingHours = Math.round(records.reduce((sum, r) => sum + this.hoursOf(r.checkIn, r.checkOut), 0) * 100) / 100;
      const otHours = Math.round(records.reduce((sum, r) => sum + (Number(r.overtimeHours) || 0), 0) * 100) / 100;
      const departmentRate = departments.find((d) => d.name === emp.department)?.otRatePerHour;
      const otRate = emp.otRatePerHour != null ? Number(emp.otRatePerHour) : Number(departmentRate) || 0;

      if (!row) {
        row = this.repo.create({ employeeId: emp.id, periodFrom: from, periodTo: to, status: 'draft' });
      }
      row.staffName = emp.name;
      row.staffSalary = Number(emp.baseSalary) || 0;
      row.allowances = this.allowancesOf(emp);
      row.socialProtectionCovered = !!emp.socialProtectionCovered;
      row.periodDays = periodDays;
      row.employedDays = employedDays;
      row.unpaidDays = r1(absentDays + halfDays * 0.5);
      row.workingDays = workingDays;
      row.presentDays = presentDays;
      row.absentDays = absentDays;
      row.workingHours = workingHours;
      row.otHours = otHours;
      row.otRate = r3(otRate);
      row.otPay = r3(otHours * otRate);
      const payable = this.computeAmounts(row, s);
      this.applyAdvance(row, payable, await this.allocateAdvances(emp.id, payable));
      rowsToSave.push(row);
    }
    if (rowsToSave.length) await this.repo.save(rowsToSave);

    return this.repo.find({ where: { periodFrom: from, periodTo: to }, order: { staffName: 'ASC' } });
  }

  private async findRow(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Payroll record not found');
    return row;
  }

  async update(id: string, dto: UpdatePayrollDto) {
    const row = await this.findRow(id);
    if (row.status !== 'draft') {
      throw new BadRequestException('Only a draft payroll row can be changed - move it back to draft first (if it is not paid).');
    }
    if (dto.staffSalary !== undefined) row.staffSalary = dto.staffSalary;
    if (dto.allowances !== undefined) row.allowances = dto.allowances;
    if (dto.unpaidDays !== undefined) row.unpaidDays = r1(dto.unpaidDays);
    if (dto.salaryPaidBy !== undefined) row.salaryPaidBy = dto.salaryPaidBy;
    const payable = this.computeAmounts(row, await this.settings());
    this.applyAdvance(row, payable, await this.allocateAdvances(row.employeeId, payable));
    return this.repo.save(row);
  }

  async remove(id: string) {
    const row = await this.findRow(id);
    if (row.status !== 'draft') {
      throw new BadRequestException('Only a draft payroll row can be deleted - an approved or paid one is in the books.');
    }
    await this.repo.remove(row);
    return { success: true };
  }

  // Approve: books the month's salary cost and what is owed, dated the last
  // day of the month. Advance installments are taken now (re-checked
  // against what is still outstanding).
  async approve(id: string, actor: ActorRef = {}) {
    const s = await this.settings();
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(PayrollRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('Payroll record not found');
      if (row.status !== 'draft') throw new BadRequestException(`This payroll row is already ${row.status}.`);
      await this.journalPosting.assertDateOpen(row.periodTo, `Payroll for ${row.periodFrom.slice(0, 7)}`, manager);

      const payable = this.computeAmounts(row, s);
      const alloc = row.employeeId ? await this.allocateAdvances(row.employeeId, payable, manager) : [];
      this.applyAdvance(row, payable, alloc);
      for (const a of alloc) {
        const adv = await manager.findOne(SalaryAdvanceRequest, { where: { id: a.advanceId } });
        if (adv) {
          adv.recoveredAmount = r3(Number(adv.recoveredAmount || 0) + a.amount);
          await manager.save(adv);
        }
      }

      const wages = r3(Number(row.grossPay) - Number(row.absenceDeduction) + Number(row.otPay));
      const lines: PostingLine[] = [];
      if (wages > 0) lines.push({ accountId: await this.journalPosting.findAccountIdByCode(WAGES_SALARIES_CODE), debit: wages, description: 'Wages & salaries' });
      if (Number(row.spfEmployer) > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(SPF_EMPLOYER_EXPENSE_CODE), debit: Number(row.spfEmployer), description: 'Social Protection Fund - employer share' });
      }
      if (Number(row.calculatedSalary) > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(SALARIES_PAYABLE_CODE), credit: Number(row.calculatedSalary), description: `Net pay - ${row.staffName}` });
      }
      const spfTotal = r3(Number(row.spfEmployee) + Number(row.spfEmployer));
      if (spfTotal > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(SPF_PAYABLE_CODE), credit: spfTotal, description: 'Social Protection Fund (employee + employer)' });
      }
      if (Number(row.advanceRecovery) > 0) {
        lines.push({ accountId: await this.journalPosting.findAccountIdByCode(SALARY_ADVANCE_CODE), credit: Number(row.advanceRecovery), description: 'Salary advance recovered' });
      }
      await this.journalPosting.postForSource(
        'payroll_accrual',
        row.id,
        row.periodTo,
        `Payroll ${row.periodFrom.slice(0, 7)} - ${row.staffName}`,
        lines,
        actor,
        row.staffName,
        manager,
      );

      row.status = 'approved';
      row.approvedAt = new Date();
      row.approvedByEmail = actor.email || null;
      return manager.save(row);
    });
  }

  // Approve every draft row of a month.
  async approveMonth(dto: ApprovePayrollDto, actor: ActorRef = {}) {
    this.assertMonth(dto.from, dto.to);
    const rows = await this.repo.find({ where: { periodFrom: dto.from, periodTo: dto.to, status: 'draft' } });
    const done: string[] = [];
    for (const r of rows) {
      await this.approve(r.id, actor);
      done.push(r.staffName);
    }
    return { approved: done.length };
  }

  // Back to draft (not paid yet): removes the accrual and gives the advance
  // installments back.
  async unapprove(id: string, actor: ActorRef = {}) {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(PayrollRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('Payroll record not found');
      if (row.status !== 'approved') throw new BadRequestException('Only an approved (not yet paid) row can go back to draft.');
      await this.journalPosting.postForSource('payroll_accrual', row.id, row.periodTo, '', [], actor, undefined, manager);
      const alloc: AdvanceAllocation[] = row.advanceAllocations ? JSON.parse(row.advanceAllocations) : [];
      for (const a of alloc) {
        const adv = await manager.findOne(SalaryAdvanceRequest, { where: { id: a.advanceId }, lock: { mode: 'pessimistic_write' } });
        if (adv) {
          adv.recoveredAmount = Math.max(0, r3(Number(adv.recoveredAmount || 0) - a.amount));
          await manager.save(adv);
        }
      }
      row.status = 'draft';
      row.approvedAt = null;
      row.approvedByEmail = null;
      return manager.save(row);
    });
  }

  // Pays the net salary of an approved row: Dr Salaries Payable / Cr bank.
  async markPaid(id: string, dto: MarkPayrollPaidDto, actor: ActorRef = {}) {
    const row = await this.findRow(id);
    if (row.status === 'paid' || row.isPaid) throw new BadRequestException('This payroll row is already marked paid.');
    if (row.status !== 'approved') throw new BadRequestException('Approve this payroll row before paying it.');
    const today = omanToday();
    await this.journalPosting.assertDateOpen(today, 'Paying salary today');

    // claim it so a double tap can't pay twice
    const claim = await this.repo.update({ id, status: 'approved' }, { status: 'paying' });
    if (claim.affected !== 1) throw new BadRequestException('This payroll row is already being paid.');

    try {
      const amount = Number(row.calculatedSalary);
      if (amount > 0) {
        const txn = await this.bankAccountService.addTransaction(dto.bankAccountId, {
          type: BankTransactionType.WITHDRAWAL,
          amount,
          date: today,
          note: `Salary - ${row.staffName} (${row.periodFrom.slice(0, 7)})`,
        });
        row.bankAccountId = dto.bankAccountId;
        row.bankTransactionId = txn.id;
      }
      row.isPaid = true;
      row.status = 'paid';
      row.paidDate = today;
      const saved = await this.repo.save(row);

      if (amount > 0) {
        try {
          await this.journalPosting.postForSource(
            'payroll',
            saved.id,
            today,
            `Salary paid - ${saved.staffName} (${saved.periodFrom.slice(0, 7)})`,
            [
              { accountId: await this.journalPosting.findAccountIdByCode(SALARIES_PAYABLE_CODE), debit: amount, description: 'Salaries payable' },
              { accountId: await this.bankAccountService.ensureJournalAccountId(dto.bankAccountId), credit: amount, description: 'Salary payout' },
            ],
            actor,
            saved.staffName,
          );
        } catch (err) {
          console.error(`Auto-posting failed for payroll ${saved.id}:`, err);
        }
      }
      return saved;
    } catch (err) {
      await this.repo.update({ id, status: 'paying' }, { status: 'approved' });
      throw err;
    }
  }
}
