import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Invoice } from './invoice.entity';
import { CustomerService } from '../customer/customer.service';
import { EmailService } from '../common/email.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

// CRM Step 5 — Payment Reminder Automation.
//
// Every day, every non-fully-paid invoice with a dueDate is checked
// against two milestone lists (configurable via .env, sensible defaults
// if unset):
//   PAYMENT_REMINDER_DUE_SOON_DAYS   — days *before* the due date to send
//                                      a friendly heads-up (default: 3)
//   PAYMENT_REMINDER_OVERDUE_DAYS    — days *after* the due date to send
//                                      a firmer notice (default: 1,7,15,30)
//   PAYMENT_REMINDER_NOTIFY_DAYS     — overdue milestones that ALSO alert
//                                      the internal accounting team
//                                      (default: 30)
// Each milestone fires exactly once per invoice — Invoice.lastReminderMilestone
// records the last one sent so the same day's cron run (or a later one)
// never repeats it. One-directional dependency on repos + CustomerService
// only (not InvoiceService), matching this codebase's existing pattern
// for sibling services.
@Injectable()
export class PaymentReminderService {
  private readonly logger = new Logger(PaymentReminderService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    private customerService: CustomerService,
    private emailService: EmailService,
    private activityLog: ActivityLogService,
    private config: ConfigService,
  ) {}

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  private parseDayList(envKey: string, fallback: number[]): number[] {
    const raw = this.config.get(envKey);
    if (!raw) return fallback;
    const parsed = String(raw)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0);
    return parsed.length > 0 ? parsed : fallback;
  }

  // Runs once a day at 08:00 server time. Kept as a fixed schedule (not
  // configurable) since the milestone day-lists above are the intended
  // customization surface — the run time itself rarely matters as long
  // as it's a normal business hour.
  @Cron('0 8 * * *')
  async runDailyCheck() {
    if (String(this.config.get('PAYMENT_REMINDER_ENABLED')).toLowerCase() === 'false') {
      return;
    }
    const result = await this.checkAndSendReminders();
    this.logger.log(`Payment reminder run: ${result.sent} sent, ${result.skipped} skipped.`);
  }

  // Core logic, also reachable without waiting for the cron (useful for
  // testing after a deploy). Returns counts rather than throwing on
  // individual invoice failures, so one bad row doesn't stop the rest.
  async checkAndSendReminders() {
    const dueSoonDays = this.parseDayList('PAYMENT_REMINDER_DUE_SOON_DAYS', [3]);
    const overdueDays = this.parseDayList('PAYMENT_REMINDER_OVERDUE_DAYS', [1, 7, 15, 30]);
    const notifyDays = this.parseDayList('PAYMENT_REMINDER_NOTIFY_DAYS', [30]);

    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.paymentStatus != :paid', { paid: 'paid' })
      .andWhere('invoice.dueDate IS NOT NULL')
      .getMany();

    const today = new Date(this.todayStr());
    let sent = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      try {
        const dueDate = new Date(invoice.dueDate);
        const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        let milestone: string | null = null;
        let kind: 'due_soon' | 'overdue' | null = null;
        let daysOverdue = 0;

        if (daysUntilDue > 0 && dueSoonDays.includes(daysUntilDue)) {
          milestone = `due_soon_${daysUntilDue}`;
          kind = 'due_soon';
        } else if (daysUntilDue <= 0) {
          daysOverdue = -daysUntilDue;
          if (overdueDays.includes(daysOverdue)) {
            milestone = `overdue_${daysOverdue}`;
            kind = 'overdue';
          }
        }

        if (!milestone || invoice.lastReminderMilestone === milestone) {
          skipped++;
          continue;
        }

        const sentOk = await this.sendForInvoice(invoice, kind!, daysOverdue, milestone, notifyDays);
        if (sentOk) sent++;
        else skipped++;
      } catch (err) {
        this.logger.error(`Reminder check failed for invoice ${invoice.id}: ${(err as Error).message}`);
        skipped++;
      }
    }

    return { sent, skipped };
  }

  private async sendForInvoice(
    invoice: Invoice,
    kind: 'due_soon' | 'overdue',
    daysOverdue: number,
    milestone: string,
    notifyDays: number[],
  ): Promise<boolean> {
    const customer = await this.customerService.findOne(invoice.customerId);
    if (!customer.email) return false; // nothing to send to — silently skipped, not an error

    const outstanding = Math.round((Number(invoice.total) - Number(invoice.paidAmount || 0)) * 1000) / 1000;
    if (outstanding <= 0) return false;

    await this.emailService.sendPaymentReminder(customer.email, {
      customerName: customer.name,
      invoiceNumber: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      outstanding,
      kind,
      daysOverdue: kind === 'overdue' ? daysOverdue : undefined,
    });

    if (kind === 'overdue' && notifyDays.includes(daysOverdue)) {
      await this.emailService.sendInternalOverdueAlert(customer.name, invoice.invoiceNumber, outstanding, daysOverdue);
    }

    invoice.lastReminderSentAt = this.todayStr();
    invoice.lastReminderMilestone = milestone;
    await this.invoiceRepo.save(invoice);

    await this.activityLog.log({
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: invoice.id,
      details: { invoiceNumber: invoice.invoiceNumber, customerName: customer.name, milestone, outstanding },
    });

    return true;
  }

  // Manual "Send Reminder Now" trigger (Invoices list button). Ignores
  // the milestone dedupe so an admin can always resend on demand, but
  // still throws a clear error for the cases that genuinely make no
  // sense to send (no due date, already paid, no email on file).
  async sendManualReminder(invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.dueDate) throw new BadRequestException('This invoice has no due date set.');
    if (invoice.paymentStatus === 'paid') throw new BadRequestException('This invoice is already fully paid.');

    const customer = await this.customerService.findOne(invoice.customerId);
    if (!customer.email) throw new BadRequestException(`${customer.name} has no email address on file.`);

    const today = new Date(this.todayStr());
    const dueDate = new Date(invoice.dueDate);
    const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const kind: 'due_soon' | 'overdue' = daysUntilDue > 0 ? 'due_soon' : 'overdue';
    const daysOverdue = daysUntilDue > 0 ? 0 : -daysUntilDue;
    const milestone = kind === 'due_soon' ? `manual_due_soon_${daysUntilDue}` : `manual_overdue_${daysOverdue}`;
    const notifyDays = this.parseDayList('PAYMENT_REMINDER_NOTIFY_DAYS', [30]);

    const ok = await this.sendForInvoice(invoice, kind, daysOverdue, milestone, notifyDays);
    if (!ok) throw new BadRequestException('Could not send — this invoice may already be fully paid.');
    return { sent: true };
  }
}
