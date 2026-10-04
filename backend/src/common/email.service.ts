import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') || 587),
        secure: false,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
    }
  }

  // Notifies CEO, MD, and Accountant whenever an invoice has VAT excluded.
  // Recipient emails are configured once in .env (comma-separated),
  // so no code change is needed if the people in these roles change.
  async sendVatExcludedNotice(invoiceNumber: string, customerName: string, total: number) {
    const recipients = (this.config.get('VAT_EXCLUDE_NOTIFY_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      this.logger.warn(
        'VAT_EXCLUDE_NOTIFY_EMAILS not set in .env — skipping VAT-exclude notification email.',
      );
      return;
    }

    const subject = `VAT excluded on invoice ${invoiceNumber}`;
    const body = `Invoice ${invoiceNumber} for ${customerName} (total: ${total} OMR) was issued with VAT excluded. Please review.`;

    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Notifies MD, CEO, and GM whenever a customer record is deleted.
  // Recipient emails are configured once in .env (comma-separated),
  // so no code change is needed if the people in these roles change.
  async sendCustomerDeletedNotice(customerName: string, deletedBy?: string) {
    const recipients = (this.config.get('CUSTOMER_DELETE_NOTIFY_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      this.logger.warn(
        'CUSTOMER_DELETE_NOTIFY_EMAILS not set in .env — skipping customer-delete notification email.',
      );
      return;
    }

    const subject = `Customer deleted: ${customerName}`;
    const body = `Customer "${customerName}" was deleted from the ERP${deletedBy ? ` by ${deletedBy}` : ''}. This cannot be undone from the system — please review if this was not expected.`;

    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Notifies MD, CEO, and GM whenever a supplier record is deleted —
  // mirrors sendCustomerDeletedNotice above. Falls back to
  // CUSTOMER_DELETE_NOTIFY_EMAILS if SUPPLIER_DELETE_NOTIFY_EMAILS isn't
  // set, since the same people usually need to know either way.
  async sendSupplierDeletedNotice(supplierName: string, deletedBy?: string) {
    const recipients = (
      this.config.get('SUPPLIER_DELETE_NOTIFY_EMAILS') ||
      this.config.get('CUSTOMER_DELETE_NOTIFY_EMAILS') ||
      ''
    )
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      this.logger.warn(
        'SUPPLIER_DELETE_NOTIFY_EMAILS (or CUSTOMER_DELETE_NOTIFY_EMAILS) not set in .env — skipping supplier-delete notification email.',
      );
      return;
    }

    const subject = `Supplier deleted: ${supplierName}`;
    const body = `Supplier "${supplierName}" was deleted from the ERP${deletedBy ? ` by ${deletedBy}` : ''}. This cannot be undone from the system — please review if this was not expected.`;

    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Payment Reminder Automation (Step 5) — sent to the customer directly.
  // `kind` picks the tone: a friendly heads-up before the due date, or a
  // firmer notice once it's overdue.
  async sendPaymentReminder(
    to: string,
    params: {
      customerName: string;
      invoiceNumber: string;
      dueDate: string;
      outstanding: number;
      kind: 'due_soon' | 'overdue';
      daysOverdue?: number;
    },
  ) {
    const subject =
      params.kind === 'due_soon'
        ? `Reminder: Invoice ${params.invoiceNumber} is due on ${params.dueDate}`
        : `Overdue: Invoice ${params.invoiceNumber} — ${params.daysOverdue} day(s) past due`;

    const body =
      params.kind === 'due_soon'
        ? `Dear ${params.customerName},\n\nThis is a reminder that invoice ${params.invoiceNumber} (${params.outstanding.toFixed(3)} OMR) is due on ${params.dueDate}. Kindly arrange payment by then.\n\nThank you.`
        : `Dear ${params.customerName},\n\nInvoice ${params.invoiceNumber} (${params.outstanding.toFixed(3)} OMR) was due on ${params.dueDate} and is now ${params.daysOverdue} day(s) overdue. Kindly settle this at your earliest convenience.\n\nThank you.`;

    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to [${to}]: ${subject}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to,
      subject,
      text: body,
    });
  }

  // CRM Step 7 — Approval Workflow. Lets approvers know a new request is
  // waiting on the Approvals dashboard, rather than relying on them to
  // check it themselves periodically.
  async sendApprovalRequestNotice(type: string, entityType: string, reason: string, requestedByEmail?: string) {
    const recipients = (this.config.get('APPROVAL_NOTIFY_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0) return;

    const subject = `Approval needed: ${type.replace(/_/g, ' ')} (${entityType})`;
    const body = `A new ${entityType} was submitted${requestedByEmail ? ` by ${requestedByEmail}` : ''} and needs approval:\n\n${reason}\n\nReview it on the Approvals dashboard.`;

    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Internal heads-up to the accounting team once an invoice crosses a
  // serious-overdue milestone — separate from the customer-facing
  // reminder above, and only fired for the milestones configured via
  // PAYMENT_REMINDER_NOTIFY_DAYS (e.g. 30/60 days overdue).
  async sendInternalOverdueAlert(customerName: string, invoiceNumber: string, outstanding: number, daysOverdue: number) {
    const recipients = (this.config.get('PAYMENT_REMINDER_NOTIFY_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0) return;

    const subject = `Seriously overdue: ${customerName} — invoice ${invoiceNumber} (${daysOverdue} days)`;
    const body = `Invoice ${invoiceNumber} for ${customerName} (${outstanding.toFixed(3)} OMR outstanding) is now ${daysOverdue} days overdue. Please follow up.`;

    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Sent when the nightly off-site backup (Cloudflare R2) fails, so a
  // silently broken backup gets noticed. Recipients: OFFSITE_BACKUP_ALERT_EMAILS.
  async sendOffsiteBackupFailed(errorMessage: string, lastSuccessAt: string | null) {
    const recipients = (this.config.get('OFFSITE_BACKUP_ALERT_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      this.logger.warn('OFFSITE_BACKUP_ALERT_EMAILS not set — skipping the off-site backup failure email.');
      return;
    }

    const subject = 'ARIBS ERP: off-site backup FAILED';
    const body = [
      'Tonight\'s off-site backup (Cloudflare R2) did not complete.',
      '',
      `Error: ${errorMessage}`,
      `Last successful off-site backup: ${lastSuccessAt || 'never'}`,
      '',
      'The local backup on the server is not affected. Check Settings > Database Backup in the ERP,',
      'and the OFFSITE_BACKUP_* settings on the hosting panel.',
    ].join('\n');

    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }

  // Invoices that were waiting for stock can now be delivered.
  // Recipients: STOCK_ALERT_EMAILS (falls back to ERROR_ALERT_EMAILS).
  async sendStockReadyNotice(invoiceLines: string[]) {
    const recipients = (this.config.get('STOCK_ALERT_EMAILS') || this.config.get('ERROR_ALERT_EMAILS') || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0 || invoiceLines.length === 0) return;

    const subject = `Stock ready to deliver: ${invoiceLines.length} invoice(s)`;
    const body = [
      'Stock has arrived for invoices that were waiting for it:',
      '',
      ...invoiceLines.map((l) => `- ${l}`),
      '',
      'See Delivery Notes > Not Delivered Yet in the ERP.',
    ].join('\n');

    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to [${recipients.join(', ')}]: ${subject}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM') || 'erp@aribs.net',
      to: recipients.join(','),
      subject,
      text: body,
    });
  }
}
