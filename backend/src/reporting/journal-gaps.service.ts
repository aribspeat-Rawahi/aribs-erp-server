import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvoiceService } from '../invoice/invoice.service';
import { InvoicePaymentService } from '../invoice/invoice-payment.service';
import { SupplierPaymentService } from '../supplier/supplier-payment.service';
import { ExpenseService } from '../accounting/expense.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JournalPostingService } from '../journal/journal-posting.service';

export interface MissingJournal {
  sourceType: string;
  label: string;
  id: string;
  number: string;
  date: string;
  amount: number;
  // false = can't be rebuilt from the saved record (the cost used at the
  // time isn't stored) - needs the developer.
  canRepost: boolean;
  // dated inside the closed books (filed VAT return / opening date): it can
  // never be posted on its own date - needs the developer (manual journals
  // can't touch control accounts).
  locked: boolean;
}

interface ActorRef {
  userId?: string;
  email?: string;
}

// One query per document type: the documents that SHOULD have an
// auto-posted journal entry but don't (a posting failed after the
// document was saved). Conditions mirror each service's postJournalEntry.
const GAP_QUERIES: { sourceType: string; label: string; canRepost: boolean; sql: string }[] = [
  {
    sourceType: 'invoice',
    label: 'Invoice',
    canRepost: true,
    sql: `SELECT t.id, t.invoiceNumber AS number, DATE_FORMAT(t.issueDate, '%Y-%m-%d') AS date, t.total AS amount
          FROM invoices t
          LEFT JOIN journal_entries e ON e.sourceType = 'invoice' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.isOpening = 0 AND t.total > 0`,
  },
  {
    sourceType: 'invoice_cogs',
    label: 'Invoice - cost of goods sold',
    canRepost: true,
    sql: `SELECT t.id, t.invoiceNumber AS number, DATE_FORMAT(t.issueDate, '%Y-%m-%d') AS date, t.cogsAmount AS amount
          FROM invoices t
          LEFT JOIN journal_entries e ON e.sourceType = 'invoice_cogs' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.isOpening = 0 AND t.cogsAmount > 0`,
  },
  {
    sourceType: 'invoice_payment',
    label: 'Customer payment',
    canRepost: true,
    sql: `SELECT t.id, i.invoiceNumber AS number, DATE_FORMAT(t.paymentDate, '%Y-%m-%d') AS date, t.amount AS amount
          FROM invoice_payments t
          LEFT JOIN invoices i ON i.id = t.invoiceId
          LEFT JOIN journal_entries e ON e.sourceType = 'invoice_payment' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.bankAccountId IS NOT NULL AND t.salesReturnId IS NULL`,
  },
  {
    sourceType: 'supplier_payment',
    label: 'Supplier payment',
    canRepost: true,
    sql: `SELECT t.id, o.poNumber AS number, DATE_FORMAT(t.paymentDate, '%Y-%m-%d') AS date, t.amount AS amount
          FROM supplier_payments t
          LEFT JOIN purchase_orders o ON o.id = t.purchaseOrderId
          LEFT JOIN journal_entries e ON e.sourceType = 'supplier_payment' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.bankAccountId IS NOT NULL AND t.creditSource IS NULL`,
  },
  {
    sourceType: 'expense',
    label: 'Expense',
    canRepost: true,
    sql: `SELECT t.id, COALESCE(t.invoiceNumber, t.category) AS number, DATE_FORMAT(t.date, '%Y-%m-%d') AS date, t.amount AS amount
          FROM expenses t
          LEFT JOIN journal_entries e ON e.sourceType = 'expense' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.bankAccountId IS NOT NULL`,
  },
  // Posted in the same transaction as the document since this change, so
  // only older records can show up here.
  {
    sourceType: 'goods_receipt',
    label: 'Goods receipt',
    canRepost: false,
    sql: `SELECT t.id, t.grnNumber AS number, DATE_FORMAT(t.receivedDate, '%Y-%m-%d') AS date, t.total AS amount
          FROM goods_receipts t
          LEFT JOIN journal_entries e ON e.sourceType = 'goods_receipt' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.total > 0`,
  },
  {
    sourceType: 'sales_return',
    label: 'Sales return',
    canRepost: false,
    sql: `SELECT t.id, t.returnNumber AS number, DATE_FORMAT(t.date, '%Y-%m-%d') AS date, t.total AS amount
          FROM sales_returns t
          LEFT JOIN journal_entries e ON e.sourceType = 'sales_return' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.status = 'approved'`,
  },
  {
    sourceType: 'purchase_return',
    label: 'Purchase return',
    canRepost: false,
    sql: `SELECT t.id, t.returnNumber AS number, DATE_FORMAT(t.date, '%Y-%m-%d') AS date, t.total AS amount
          FROM purchase_returns t
          LEFT JOIN journal_entries e ON e.sourceType = 'purchase_return' AND e.sourceId = t.id
          WHERE e.id IS NULL AND t.status = 'approved'`,
  },
];

// Books Health Check: documents saved without their journal entry, and a
// "Re-post" that rebuilds the entry from the saved document.
@Injectable()
export class JournalGapsService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private invoices: InvoiceService,
    private invoicePayments: InvoicePaymentService,
    private supplierPayments: SupplierPaymentService,
    private expenses: ExpenseService,
    private activityLog: ActivityLogService,
    private journalPosting: JournalPostingService,
  ) {}

  async findMissing(): Promise<MissingJournal[]> {
    const out: MissingJournal[] = [];
    const lock = await this.journalPosting.lockInfo();
    for (const q of GAP_QUERIES) {
      const rows: { id: string; number: string | null; date: string | null; amount: string | number }[] = await this.dataSource.query(q.sql);
      for (const r of rows) {
        out.push({
          sourceType: q.sourceType,
          label: q.label,
          id: r.id,
          number: r.number || '',
          // formatted in SQL - a raw DATE comes back as a JS Date (timezone-shifted)
          date: String(r.date || '').slice(0, 10),
          amount: Math.round(Number(r.amount || 0) * 1000) / 1000,
          canRepost: q.canRepost,
          locked: !!lock && String(r.date || '').slice(0, 10) <= lock.date,
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async repost(sourceType: string, sourceId: string, actor: ActorRef) {
    if (!sourceId) throw new BadRequestException('Missing document id.');
    let result: { reposted: boolean; number?: string };
    switch (sourceType) {
      case 'invoice':
      case 'invoice_cogs':
        result = await this.invoices.repostJournal(sourceId, actor);
        break;
      case 'invoice_payment':
        result = await this.invoicePayments.repostJournal(sourceId, actor);
        break;
      case 'supplier_payment':
        result = await this.supplierPayments.repostJournal(sourceId, actor);
        break;
      case 'expense':
        result = await this.expenses.repostJournal(sourceId, actor);
        break;
      default:
        throw new BadRequestException(
          'This document type cannot be re-posted automatically - its original cost is not stored. Contact support.',
        );
    }
    await this.activityLog.log({
      action: 'journal.reposted',
      entityType: sourceType,
      entityId: sourceId,
      userId: actor.userId,
      userEmail: actor.email,
      details: { number: result.number },
    });
    return result;
  }
}
