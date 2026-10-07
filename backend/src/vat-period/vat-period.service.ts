import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { VatPeriod, VatPeriodStatus } from './vat-period.entity';
import { FileVatPeriodDto, VatPeriodSettingsDto } from './vat-period.dto';
import { Settings } from '../settings/settings.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { TaxPayment } from '../tax/tax-payment.entity';
import { ReportingService } from '../reporting/reporting.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { EmailService } from '../common/email.service';
import { User, UserRole } from '../auth/user.entity';

interface Actor {
  userId?: string;
  email?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOTIFY_ROLES = [UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT];
// Oman: the return is filed and the VAT paid within 30 days after the
// period ends (next working day if that is a weekend/holiday).
const FILING_DAYS = 30;

export interface ComputedPeriod {
  label: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  state: 'in_progress' | 'due' | 'overdue' | 'filed';
  daysToDue: number;
  canFile: boolean;
  blockedReason: string | null;
  paid: number;
  filed: VatPeriod | null;
  history: VatPeriod[]; // earlier filings of this period that were reopened
}

// VAT returns (Accounting > Tax > VAT Returns). Periods are worked out
// from the settings (quarterly / monthly, cycle start month) from the
// first day of the books up to today. Marking a period as filed stores a
// snapshot of its VAT figures and closes the books up to its last day;
// only Admin/CEO/MD can reopen the latest one, with a reason.
@Injectable()
export class VatPeriodService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private reporting: ReportingService,
    private activityLog: ActivityLogService,
    private email: EmailService,
  ) {}

  private round3(n: number) {
    return Math.round(Number(n || 0) * 1000) / 1000;
  }

  private today() {
    // the business runs on Oman time
    return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private ymd(y: number, m: number, d: number) {
    // m is 1-12; Date.UTC handles month/day overflow
    return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  }

  private addDays(date: string, n: number) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  private daysBetween(a: string, b: string) {
    return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
  }

  private async settings(m: EntityManager = this.dataSource.manager) {
    let s = await m.findOne(Settings, { where: { id: 1 } });
    if (!s) s = await m.save(m.create(Settings, { id: 1 }));
    return s;
  }

  // nominal period containing `date`
  private periodOf(date: string, months: number, startMonth: number) {
    const y = Number(date.slice(0, 4));
    const mo = Number(date.slice(5, 7));
    const offset = (((mo - startMonth) % months) + months) % months;
    let sy = y;
    let sm = mo - offset;
    if (sm < 1) {
      sm += 12;
      sy -= 1;
    }
    const start = this.ymd(sy, sm, 1);
    const end = this.ymd(sy, sm + months, 0); // day 0 = last day of the previous month
    return { start, end };
  }

  private label(start: string, end: string) {
    const s = { y: start.slice(0, 4), m: MONTHS[Number(start.slice(5, 7)) - 1] };
    const e = { y: end.slice(0, 4), m: MONTHS[Number(end.slice(5, 7)) - 1] };
    if (start.slice(0, 7) === end.slice(0, 7)) return `VAT ${s.m} ${s.y}`;
    return s.y === e.y ? `VAT ${s.m}-${e.m} ${s.y}` : `VAT ${s.m} ${s.y}-${e.m} ${e.y}`;
  }

  // First day the ERP's books cover: the day after the opening balance
  // date, else the first journal entry, else today.
  private async firstDay(s: Settings, rows: VatPeriod[]) {
    const candidates: string[] = [];
    if (s.openingBalanceDate) candidates.push(this.addDays(String(s.openingBalanceDate).slice(0, 10), 1));
    else {
      // formatted in SQL: a raw MIN() of a DATE column comes back as a JS
      // Date object (not 'YYYY-MM-DD'), which broke the period maths
      const first = await this.dataSource.manager
        .createQueryBuilder(JournalEntry, 'e')
        .select("DATE_FORMAT(MIN(e.date), '%Y-%m-%d')", 'min')
        .getRawOne();
      if (first?.min) candidates.push(String(first.min).slice(0, 10));
    }
    for (const r of rows) candidates.push(String(r.startDate).slice(0, 10));
    const valid = candidates.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
    return valid.length ? valid.sort()[0] : this.today();
  }

  async list() {
    const s = await this.settings();
    const rows = await this.dataSource.manager.find(VatPeriod, { order: { endDate: 'ASC', createdAt: 'ASC' } });
    const periods = await this.compute(s, rows);
    const today = this.today();
    const next = periods.filter((p) => p.state === 'due' || p.state === 'overdue').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
    return {
      settings: { vatPeriodMonths: s.vatPeriodMonths, vatPeriodStartMonth: s.vatPeriodStartMonth },
      settingsLocked: rows.some((r) => r.status === VatPeriodStatus.FILED),
      lockedThrough: periods.filter((p) => p.state === 'filed').map((p) => p.endDate).sort().pop() || null,
      today,
      periods: [...periods].reverse(), // newest first
      // for the Dashboard alert: the oldest unfiled return that is due
      nextDue: next ? { label: next.label, dueDate: next.dueDate, daysToDue: next.daysToDue, overdue: next.state === 'overdue' } : null,
    };
  }

  private async compute(s: Settings, rows: VatPeriod[]): Promise<ComputedPeriod[]> {
    const months = s.vatPeriodMonths === 1 ? 1 : 3;
    const startMonth = Math.min(12, Math.max(1, Number(s.vatPeriodStartMonth) || 1));
    const today = this.today();
    const first = await this.firstDay(s, rows);
    const payments = await this.dataSource.manager.find(TaxPayment);
    const out: ComputedPeriod[] = [];
    let { start, end } = this.periodOf(first, months, startMonth);
    let previousUnfiled: string | null = null;
    for (let guard = 0; guard < 400 && start <= today; guard++) {
      const label = this.label(start, end);
      const startDate = start < first ? first : start; // the first period may start mid-way
      const filed = rows.find((r) => r.status === VatPeriodStatus.FILED && String(r.endDate).slice(0, 10) === end) || null;
      const history = rows.filter((r) => r.status === VatPeriodStatus.REOPENED && String(r.endDate).slice(0, 10) === end);
      const dueDate = this.addDays(end, FILING_DAYS);
      const ended = today > end;
      const state: ComputedPeriod['state'] = filed ? 'filed' : !ended ? 'in_progress' : today > dueDate ? 'overdue' : 'due';
      let blockedReason: string | null = null;
      if (!filed) {
        if (!ended) blockedReason = `The period ends on ${end}; it can be filed from the next day.`;
        else if (previousUnfiled) blockedReason = `File ${previousUnfiled} first.`;
      }
      out.push({
        label,
        startDate,
        endDate: end,
        dueDate,
        state,
        daysToDue: this.daysBetween(today, dueDate),
        canFile: !filed && !blockedReason,
        blockedReason,
        paid: this.round3(payments.filter((p) => p.period === label).reduce((t, p) => t + Number(p.amount), 0)),
        filed,
        history,
      });
      if (!filed && !previousUnfiled) previousUnfiled = label;
      const nextStart = this.addDays(end, 1);
      ({ start, end } = this.periodOf(nextStart, months, startMonth));
    }
    return out;
  }

  // ------------------------------------------------------------- actions

  async updateSettings(dto: VatPeriodSettingsDto, actor: Actor) {
    return this.dataSource.transaction(async (m) => {
      const s = await this.settings(m);
      const filed = await m.count(VatPeriod, { where: { status: VatPeriodStatus.FILED } });
      if (filed && (dto.vatPeriodMonths !== s.vatPeriodMonths || dto.vatPeriodStartMonth !== s.vatPeriodStartMonth)) {
        throw new BadRequestException('VAT returns are already filed with these periods. Reopen them first to change the period settings.');
      }
      s.vatPeriodMonths = dto.vatPeriodMonths;
      s.vatPeriodStartMonth = dto.vatPeriodStartMonth;
      await m.save(s);
      await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'vat_period.settings', entityType: 'settings', entityId: '1', details: { ...dto } });
      return { vatPeriodMonths: s.vatPeriodMonths, vatPeriodStartMonth: s.vatPeriodStartMonth };
    });
  }

  async file(dto: FileVatPeriodDto, actor: Actor) {
    const saved = await this.dataSource.transaction(async (m) => {
      // one filing at a time
      const s = await m.findOne(Settings, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw new BadRequestException('Settings missing');
      const rows = await m.find(VatPeriod, { order: { endDate: 'ASC' } });
      const periods = await this.compute(s, rows);
      const p = periods.find((x) => x.startDate === dto.startDate.slice(0, 10) && x.endDate === dto.endDate.slice(0, 10));
      if (!p) throw new NotFoundException('This VAT period does not match the period settings.');
      if (p.filed) throw new BadRequestException(`${p.label} is already filed.`);
      if (!p.canFile) throw new BadRequestException(p.blockedReason || 'This period cannot be filed yet.');

      const v = await this.reporting.getVatSummary(p.startDate, p.endDate);
      const row = m.create(VatPeriod, {
        label: p.label,
        startDate: p.startDate,
        endDate: p.endDate,
        status: VatPeriodStatus.FILED,
        otaReference: dto.otaReference?.trim() || null,
        note: dto.note?.trim() || null,
        taxableSales: this.round3(v.taxableSales),
        outputVat: this.round3(v.outputVat),
        taxablePurchases: this.round3(v.taxablePurchases),
        inputVat: this.round3(v.inputVat),
        netVat: this.round3(v.netVatPayable),
        purchaseRowsMissingDocuments: Number(v.purchaseRowsMissingDocuments || 0),
        filedAt: new Date(),
        filedBy: actor.email || null,
      });
      return m.save(row);
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'vat_period.filed',
      entityType: 'vat_period',
      entityId: saved.id,
      details: { label: saved.label, startDate: saved.startDate, endDate: saved.endDate, netVat: saved.netVat, otaReference: saved.otaReference },
    });
    this.notify(
      `VAT return filed: ${saved.label} - books closed up to ${saved.endDate}`,
      [
        `The ${saved.label} VAT return (${saved.startDate} to ${saved.endDate}) was marked as filed in ARIBS ERP.`,
        '',
        `Output VAT:  ${Number(saved.outputVat).toFixed(3)} OMR`,
        `Input VAT:   ${Number(saved.inputVat).toFixed(3)} OMR`,
        `Net VAT:     ${Number(saved.netVat).toFixed(3)} OMR ${Number(saved.netVat) < 0 ? '(refundable)' : 'payable'}`,
        `OTA reference: ${saved.otaReference || '-'}`,
        `Filed by:    ${saved.filedBy || 'unknown'}`,
        '',
        `Nothing can now be recorded, changed or deleted on or before ${saved.endDate}.`,
      ].join('\n'),
    );
    return saved;
  }

  async reopen(id: string, reason: string, actor: Actor) {
    const row = await this.dataSource.transaction(async (m) => {
      await m.findOne(Settings, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
      const r = await m.findOne(VatPeriod, { where: { id } });
      if (!r) throw new NotFoundException('VAT period not found');
      if (r.status !== VatPeriodStatus.FILED) throw new BadRequestException('This VAT period is not filed.');
      const latest = await m.findOne(VatPeriod, { where: { status: VatPeriodStatus.FILED }, order: { endDate: 'DESC' } });
      if (latest && latest.id !== r.id) throw new BadRequestException(`Only the latest filed return (${latest.label}) can be reopened.`);
      r.status = VatPeriodStatus.REOPENED;
      r.reopenedAt = new Date();
      r.reopenedBy = actor.email || null;
      r.reopenReason = reason.trim();
      return m.save(r);
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'vat_period.reopened',
      entityType: 'vat_period',
      entityId: row.id,
      details: { label: row.label, reason: row.reopenReason },
    });
    this.notify(
      `VAT return REOPENED: ${row.label} - by ${row.reopenedBy || 'unknown'}`,
      [
        `The ${row.label} VAT return (${row.startDate} to ${row.endDate}) was reopened in ARIBS ERP, so entries in that period can be changed again.`,
        '',
        `Reopened by: ${row.reopenedBy || 'unknown'}`,
        `Reason:      ${row.reopenReason}`,
        `It was filed by ${row.filedBy || 'unknown'} with OTA reference ${row.otaReference || '-'} (net VAT ${Number(row.netVat).toFixed(3)} OMR).`,
        '',
        'If the figures change, an amended return / voluntary disclosure may be needed with the Oman Tax Authority.',
      ].join('\n'),
    );
    return row;
  }

  // best effort - never blocks the action
  private notify(subject: string, text: string) {
    setImmediate(async () => {
      try {
        const users = await this.dataSource.getRepository(User).find({ where: { role: In(NOTIFY_ROLES), active: true, deletedAt: IsNull() } });
        const to = [...new Set(users.map((u) => u.email).filter((e) => !!e && e.includes('@')))];
        await this.email.sendPlainNotice(to, subject, text);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`VAT period notice email failed: ${err?.message || err}`);
      }
    });
  }
}
