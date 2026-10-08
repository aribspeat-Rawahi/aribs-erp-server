import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Invoice } from './invoice.entity';
import { InvoiceItem } from './invoice-item.entity';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { CustomerService } from '../customer/customer.service';
import { EmailService } from '../common/email.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { generateInvoicePdf, InvoicePdfItem } from '../common/invoice-pdf.util';
import { generateStatementPdf, StatementTransaction } from '../common/statement-pdf.util';
import { DeliveryNoteService } from '../delivery-note/delivery-note.service';
import { InvoicePaymentService } from './invoice-payment.service';
import { computePaymentStatus } from './payment-status.util';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalRequestType, ApprovalRequestStatus } from '../approval/approval-request.entity';
import { JournalPostingService } from '../journal/journal-posting.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { UnitService } from '../units/unit.service';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { BackorderService } from '../stock-alerts/backorder.service';
import { SalesReturn, SalesReturnStatus } from './sales-return.entity';
import { buildWhatsappLinks, toWhatsappPhone } from '../common/whatsapp-phone.util';
import { runInBackground } from '../common/background.util';

// Auto-posted Chart-of-Accounts codes for invoice issuance (Dr Accounts
// Receivable / Cr Sales Revenue [+ Cr VAT Payable]) — matches the
// DEFAULT_ACCOUNTS seed in journal/account.service.ts.
const ACCOUNTS_RECEIVABLE_CODE = '1100';
const SALES_REVENUE_CODE = '1402';
const VAT_PAYABLE_CODE = '2100';
// Cost of goods sold when stock leaves with the invoice.
const COGS_CODE = '500';
const FG_INVENTORY_CODE = '1210';

// One customer's row in the Accounts Receivable Aging Report — exported
// so ReportingService (and its DTO-less controller response type) can
// reference it too.
export type AgingBucket = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90plus';
interface ActorRef {
  userId?: string;
  email?: string;
}

export interface CustomerAging {
  customerId: string;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  totalOutstanding: number;
  oldestDaysOverdue: number;
}

@Injectable()
export class InvoiceService {
  private uploadDir: string;

  constructor(
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private itemRepo: Repository<InvoiceItem>,
    private customerService: CustomerService,
    private emailService: EmailService,
    private settingsService: SettingsService,
    private activityLog: ActivityLogService,
    private config: ConfigService,
    private deliveryNoteService: DeliveryNoteService,
    // One-directional: InvoicePaymentService depends only on repos, not
    // on InvoiceService, so this doesn't create a circular dependency.
    private invoicePaymentService: InvoicePaymentService,
    // Same one-directional pattern: ApprovalService only touches repos
    // (not InvoiceService/InvoiceModule), so InvoiceModule can safely
    // import ApprovalModule without a cycle. See CRM Step 7.
    private approvalService: ApprovalService,
    private journalPosting: JournalPostingService,
    private documentLinks: DocumentLinkService,
    private units: UnitService,
    private batchTracking: BatchTrackingService,
    private backorders: BackorderService,
    @InjectDataSource() private dataSource: DataSource,
  ) {
    this.uploadDir = this.config.get('INVOICE_UPLOAD_DIR') || './uploads/invoices';
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  findAll() {
    return this.invoiceRepo.find({ order: { createdAt: 'DESC' } });
  }

  // Opening invoices (old books) are fixed once opening balances are
  // finalized; corrections go through a journal entry.
  private assertNotOpening(invoice: Invoice, action: string) {
    if (invoice.isOpening) {
      throw new BadRequestException(`${invoice.invoiceNumber} is an opening balance from the old books and cannot be ${action}. Record a payment against it, or correct it with a journal entry.`);
    }
  }

  async findOne(id: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const items = await this.itemRepo.find({ where: { invoiceId: id } });
    return { ...invoice, items };
  }

  // unit costs keep 6 decimals (amounts 3)
  private round6(n: number) {
    return Math.round(n * 1e6) / 1e6;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // VAT is summed per line using each line's OWN vatRate (a line can be
  // overridden to 0% for a zero-rated item — see purchase-order.service.ts's
  // calcTotals() for the same pattern on the purchase side), not a flat
  // rate on the whole taxable total.
  // Bug fix (2026-09-28): this used to apply a flat 5% to the whole
  // post-discount taxable amount regardless of each line's own vatRate,
  // over-charging VAT on zero-rated/discounted-rate line items.
  // The document-level discount is spread across lines pro-rata by each
  // line's share of the subtotal so it still reduces each line's own
  // taxable base before its rate is applied; the last line absorbs any
  // rounding remainder so the allocated discount always sums exactly to
  // `discount`.
  private calcTotals(
    items: { quantity: number; unitPrice: number; vatRate: number }[],
    vatExcluded: boolean,
    discountAmount = 0,
  ) {
    let subtotal = 0;
    const lineItems = items.map((i) => {
      const lineTotal = this.round3(Number(i.quantity) * Number(i.unitPrice));
      subtotal += lineTotal;
      return { ...i, lineTotal };
    });
    subtotal = this.round3(subtotal);
    const discount = this.round3(Math.min(Math.max(discountAmount, 0), subtotal));
    const taxable = this.round3(subtotal - discount);

    let vatAmount = 0;
    let allocatedDiscount = 0;
    lineItems.forEach((line, idx) => {
      const isLast = idx === lineItems.length - 1;
      const lineDiscount = isLast
        ? this.round3(discount - allocatedDiscount)
        : this.round3(subtotal > 0 ? (line.lineTotal / subtotal) * discount : 0);
      allocatedDiscount = this.round3(allocatedDiscount + lineDiscount);
      const lineTaxable = this.round3(line.lineTotal - lineDiscount);
      vatAmount += vatExcluded ? 0 : this.round3((lineTaxable * Number(line.vatRate)) / 100);
    });
    vatAmount = this.round3(vatAmount);

    return {
      lineItems,
      subtotal,
      discountAmount: discount,
      vatAmount,
      total: this.round3(taxable + vatAmount),
    };
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // Auto-posts (or re-posts) Dr 1100 Accounts Receivable / Cr 1402 Sales
  // Revenue (taxable amount) [+ Cr 2100 VAT Payable when vatAmount > 0]
  // for a saved invoice. Best-effort — an invoice is already saved and
  // its PDF generated by the time this runs, so a posting failure here
  // is logged rather than surfacing as an error on invoice create/update.
  // rethrow=true (Books Health Check "Re-post") surfaces the error
  // instead of only logging it.
  private async postJournalEntry(invoice: Invoice, actor: ActorRef = {}, rethrow = false) {
    try {
      const arAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_RECEIVABLE_CODE);
      const salesAccountId = await this.journalPosting.findAccountIdByCode(SALES_REVENUE_CODE);
      const taxable = this.round3(Number(invoice.subtotal) - Number(invoice.discountAmount || 0));
      const vatAmount = Number(invoice.vatAmount || 0);

      const lines = [
        { accountId: arAccountId, debit: Number(invoice.total), description: `Invoice ${invoice.invoiceNumber}` },
        { accountId: salesAccountId, credit: taxable, description: 'Sales revenue' },
      ];
      if (vatAmount > 0) {
        const vatAccountId = await this.journalPosting.findAccountIdByCode(VAT_PAYABLE_CODE);
        lines.push({ accountId: vatAccountId, credit: vatAmount, description: 'VAT on sale' });
      }

      await this.journalPosting.postForSource(
        'invoice',
        invoice.id,
        invoice.issueDate,
        `Invoice ${invoice.invoiceNumber}`,
        lines,
        actor,
        invoice.invoiceNumber,
      );
    } catch (err) {
      if (rethrow) throw err;
      console.error(`Auto-posting failed for invoice ${invoice.id}:`, err);
    }
  }

  // Books Health Check "Re-post": rebuilds this invoice's sales entry
  // (and its cost-of-goods-sold entry) from the saved invoice.
  async repostJournal(id: string, actor: ActorRef = {}) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    this.assertNotOpening(invoice, 're-posted');
    await this.postJournalEntry(invoice, actor, true);
    await this.postCogsJournal(invoice, actor, true);
    return { reposted: true, number: invoice.invoiceNumber };
  }

  // Dr 500 Cost of Goods Sold / Cr 1210 Finished Goods for the cost
  // saved on the invoice (cogsAmount); removes the entry when it is 0.
  private async postCogsJournal(invoice: Invoice, actor: ActorRef = {}, rethrow = false) {
    const cogs = Number(invoice.cogsAmount || 0);
    try {
      if (cogs > 0) {
        const cogsAccountId = await this.journalPosting.findAccountIdByCode(COGS_CODE);
        const fgAccountId = await this.journalPosting.findAccountIdByCode(FG_INVENTORY_CODE);
        await this.journalPosting.postForSource(
          'invoice_cogs',
          invoice.id,
          invoice.issueDate,
          `Cost of goods sold — invoice ${invoice.invoiceNumber}`,
          [
            { accountId: cogsAccountId, debit: cogs, description: 'Cost of goods sold' },
            { accountId: fgAccountId, credit: cogs, description: 'Finished goods sold' },
          ],
          actor || {},
          invoice.invoiceNumber,
        );
      } else {
        await this.journalPosting.removeForSource('invoice_cogs', invoice.id);
      }
    } catch (err) {
      if (rethrow) throw err;
      console.error(`Auto-posting failed for invoice_cogs ${invoice.id}:`, err);
    }
  }

  // Sum of (total - paidAmount) across every one of this customer's
  // invoices that isn't fully paid — their current outstanding balance.
  // `excludeInvoiceId` leaves one invoice out of the sum (used when
  // editing that same invoice, so it doesn't count against itself).
  async getOutstandingBalance(customerId: string, excludeInvoiceId?: string): Promise<number> {
    const qb = this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.customerId = :customerId', { customerId })
      .andWhere('invoice.paymentStatus != :paid', { paid: 'paid' });
    if (excludeInvoiceId) qb.andWhere('invoice.id != :excludeInvoiceId', { excludeInvoiceId });
    const invoices = await qb.getMany();
    return this.round3(invoices.reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.paidAmount || 0)), 0));
  }

  private discountApprovalThresholdPercent(): number {
    const raw = this.config.get('DISCOUNT_APPROVAL_THRESHOLD_PERCENT');
    const n = raw !== undefined ? Number(raw) : NaN;
    return !isNaN(n) && n >= 0 ? n : 10; // default: discounts over 10% of subtotal need approval
  }

  // CRM Step 7 — Approval Workflow. Checks the three gates that can
  // block a self-serve invoice create/update (none throw — the caller
  // decides what to do with the list): credit limit, large discount,
  // and a deliberate VAT-exclude override. Returns the empty array when
  // nothing is blocked.
  private async evaluateApprovalGates(
    customer: { id: string; name: string; creditLimit?: number; vatApplicable?: boolean },
    totals: { subtotal: number; discountAmount: number; total: number },
    vatExcluded: boolean,
    excludeInvoiceId?: string,
  ): Promise<{ type: ApprovalRequestType; reason: string }[]> {
    const gates: { type: ApprovalRequestType; reason: string }[] = [];

    const limit = Number(customer.creditLimit || 0);
    if (limit > 0) {
      const outstanding = await this.getOutstandingBalance(customer.id, excludeInvoiceId);
      const wouldBeOutstanding = this.round3(outstanding + totals.total);
      if (wouldBeOutstanding > limit + 0.001) {
        gates.push({
          type: ApprovalRequestType.CREDIT_LIMIT_OVERRIDE,
          reason: `${customer.name}'s outstanding balance would become ${wouldBeOutstanding.toFixed(3)} OMR, over their credit limit of ${limit.toFixed(3)} OMR.`,
        });
      }
    }

    const thresholdPercent = this.discountApprovalThresholdPercent();
    if (totals.subtotal > 0) {
      const discountPercent = (totals.discountAmount / totals.subtotal) * 100;
      if (discountPercent > thresholdPercent + 0.001) {
        gates.push({
          type: ApprovalRequestType.LARGE_DISCOUNT,
          reason: `Discount of ${discountPercent.toFixed(1)}% (${totals.discountAmount.toFixed(3)} OMR) exceeds the ${thresholdPercent}% approval threshold.`,
        });
      }
    }

    // Only a deliberate override needs sign-off — a customer whose
    // vatApplicable is structurally false doesn't trigger this every time.
    if (vatExcluded && customer.vatApplicable) {
      gates.push({
        type: ApprovalRequestType.VAT_EXCLUDE,
        reason: `VAT is being excluded for ${customer.name}, who is normally VAT-applicable.`,
      });
    }

    return gates;
  }

  private async writePdfAndGetPath(
    invoice: Invoice,
    items: InvoiceItem[],
    customerName: string,
    customerVatin?: string,
    customerAddress?: string,
    customerPhone?: string,
  ) {
    const pdfItems: InvoicePdfItem[] = items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
      vatRate: Number(i.vatRate),
      lineTotal: Number(i.lineTotal),
    }));

    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();
    const discountAmount = Number(invoice.discountAmount || 0);
    const grossAmount = Number(invoice.subtotal);
    const taxableAmount = this.round3(grossAmount - discountAmount);

    const buffer = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      version: invoice.version,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      quotationNumber: invoice.quotationNumber,
      deliveryDate: invoice.deliveryDate,
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || this.config.get('COMPANY_VATIN') || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName,
      customerAddress,
      customerPhone,
      customerVatin,
      items: pdfItems,
      grossAmount,
      discountAmount,
      taxableAmount,
      vatAmount: Number(invoice.vatAmount),
      netAmount: Number(invoice.total),
      vatExcluded: invoice.vatExcluded,
      paymentType: invoice.paymentType,
      deliveryMethod: invoice.deliveryMethod,
      logoBase64,
      template: invoice.template,
      documentType: 'invoice',
    });

    const fileName = `${invoice.invoiceNumber}-v${invoice.version}.pdf`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  // ---- Stock --------------------------------------------------------------
  // Stock leaves when the invoice is created (sales orders no longer move
  // stock). Allowed to go below zero: the invoice is then "waiting for
  // stock" until production/stock-in covers it (see BackorderService).
  // Editing an invoice moves only the difference; deleting puts it back.
  // Cost of Goods Sold is kept in invoice.cogsAmount and posted as one
  // journal entry per invoice (source 'invoice_cogs').
  private async syncStock(
    invoice: Invoice,
    oldLines: { finishedGoodId?: string | null; quantity: number | string; unitCost?: number | string | null }[],
    newLines: { finishedGoodId?: string | null; quantity: number | string }[],
    actor?: { userId?: string; email?: string },
  ) {
    const delta = new Map<string, number>(); // + = goods out, - = goods back
    for (const l of newLines) if (l.finishedGoodId) delta.set(l.finishedGoodId, (delta.get(l.finishedGoodId) || 0) + Number(l.quantity));
    for (const l of oldLines) if (l.finishedGoodId) delta.set(l.finishedGoodId, (delta.get(l.finishedGoodId) || 0) - Number(l.quantity));

    // what each product cost when it went out on this invoice
    const oldQty = new Map<string, number>();
    const oldUnit = new Map<string, number>();
    for (const l of oldLines) {
      if (!l.finishedGoodId) continue;
      oldQty.set(l.finishedGoodId, (oldQty.get(l.finishedGoodId) || 0) + Number(l.quantity));
      if (l.unitCost !== null && l.unitCost !== undefined && !oldUnit.has(l.finishedGoodId)) oldUnit.set(l.finishedGoodId, Number(l.unitCost));
    }
    const newUnit = new Map<string, number>(oldUnit);

    let cogs = Number(invoice.cogsAmount || 0);
    await this.dataSource.transaction(async (manager) => {
      for (const [productId, rawDelta] of delta) {
        const change = this.round3(rawDelta);
        if (Math.abs(change) < 0.0005) continue;
        const good = await manager.findOne(FinishedGood, { where: { id: productId }, lock: { mode: 'pessimistic_write' } });
        if (!good) continue;
        const before = Number(good.quantityInStock);
        const cost = Number(good.costPerUnit || 0);
        // goods coming back are valued at what they cost when they went out
        const outCost = oldUnit.has(productId) ? oldUnit.get(productId)! : cost;
        if (change > 0) {
          const q0 = Math.max(0, oldQty.get(productId) || 0);
          newUnit.set(productId, q0 + change > 0 ? this.round6((q0 * outCost + change * cost) / (q0 + change)) : cost);
          // only what is physically there comes out of batches
          const fromStock = Math.min(change, Math.max(before, 0));
          if (fromStock > 0.0005) {
            await this.batchTracking.consumeFinishedGoodFifo(manager, {
              finishedGoodId: productId,
              quantity: fromStock,
              invoiceId: invoice.id,
              noTopUp: true,
            });
          }
          good.quantityInStock = this.round3(before - change);
        } else {
          const back = -change;
          const after = this.round3(before + back);
          // batches only hold real (positive) stock
          const batchQty = this.round3(Math.max(0, after) - Math.max(0, before));
          if (batchQty > 0.0005) {
            await this.batchTracking.createFinishedGoodBatch(manager, { finishedGoodId: productId, quantity: batchQty, source: BatchSource.MANUAL });
          }
          // blend the returned units into the weighted-average cost
          const onHand = Math.max(0, before);
          if (onHand + back > 0) good.costPerUnit = this.round6((onHand * cost + back * outCost) / (onHand + back));
          good.quantityInStock = after;
        }
        cogs = this.round3(cogs + change * (change > 0 ? cost : outCost));
        await manager.save(good);
      }
      if (cogs < 0) cogs = 0;
      await manager.update(Invoice, { id: invoice.id }, { cogsAmount: cogs });
      for (const [productId, unit] of newUnit) {
        await manager.update(InvoiceItem, { invoiceId: invoice.id, finishedGoodId: productId }, { unitCost: unit });
      }
    });
    invoice.cogsAmount = cogs;

    await this.postCogsJournal(invoice, actor || {});

    await this.backorders.refresh([...delta.keys()]);
  }

  // Saves on each line how much was missing from stock right now.
  private async recordShortages(invoice: Invoice, items: InvoiceItem[]) {
    const productIds = [...new Set(items.map((i) => i.finishedGoodId).filter((x): x is string => !!x))];
    if (!productIds.length) return;
    const shortages = (await this.backorders.computeShortages(productIds)).get(invoice.id) || [];
    for (const item of items) {
      const missing = shortages.find((s) => s.finishedGoodId === item.finishedGoodId);
      const short = missing ? Math.min(Number(item.quantity), missing.short) : 0;
      if (missing) missing.short = this.round3(missing.short - short);
      if (Number(item.shortQuantity || 0) !== short) {
        item.shortQuantity = short;
        await this.itemRepo.update({ id: item.id }, { shortQuantity: short });
      }
    }
    const waiting = shortages.length > 0 && items.some((i) => Number(i.shortQuantity) > 0);
    if (waiting !== invoice.waitingForStock) {
      invoice.waitingForStock = waiting;
      await this.invoiceRepo.update({ id: invoice.id }, { waitingForStock: waiting, stockReadyAt: null });
    }
  }

  private async hasApprovedReturns(invoiceId: string) {
    return (await this.dataSource.getRepository(SalesReturn).count({ where: { invoiceId, status: SalesReturnStatus.APPROVED } })) > 0;
  }

  // "In Store" = the customer took the goods at the counter -> delivered.
  private applyDeliveryRule(invoice: Invoice) {
    if (invoice.deliveryMethod === 'in_store' && invoice.deliveryStatus !== 'delivered') {
      invoice.deliveryStatus = 'delivered';
      invoice.deliveredVia = 'in_store';
      invoice.deliveredAt = new Date();
    } else if (invoice.deliveryMethod !== 'in_store' && invoice.deliveredVia === 'in_store') {
      invoice.deliveryStatus = 'pending';
      invoice.deliveredVia = null;
      invoice.deliveredAt = null;
    }
  }

  // Creates a brand-new invoice: sequential number, VAT calc, PDF v1.
  // Template used = dto.template override, else the org-wide default
  // from Settings (so switching the default in Settings changes future
  // invoices without touching old ones).
  async create(dto: CreateInvoiceDto, opts?: { skipApprovalGates?: boolean; requestedBy?: { userId?: string; email?: string } }) {
    // invoices are dated today; refused if today is still inside the closed books
    await this.journalPosting.assertDateOpen(this.todayStr(), 'This invoice');
    const customer = await this.customerService.findOne(dto.customerId);
    const vatExcluded = dto.vatExcluded ?? !customer.vatApplicable;
    const settings = await this.settingsService.get();

    const lines = await this.units.resolveProductLines(dto.items);
    const { lineItems, subtotal, discountAmount, vatAmount, total } = this.calcTotals(
      lines.map((i) => ({ ...i, vatRate: i.vatRate ?? 5 })),
      vatExcluded,
      dto.discountAmount ?? 0,
    );

    if (!opts?.skipApprovalGates) {
      const gates = await this.evaluateApprovalGates(customer, { subtotal, discountAmount, total }, vatExcluded);
      if (gates.length > 0) {
        if (!dto.requestApproval) {
          throw new BadRequestException({
            approvalRequired: true,
            gates,
            message: `This invoice needs approval: ${gates.map((g) => g.reason).join(' ')}`,
          });
        }
        const approvalRequest = await this.approvalService.create({
          type: gates[0].type,
          entityType: 'invoice',
          customerId: dto.customerId,
          payload: dto,
          reason: gates.map((g) => g.reason).join(' '),
          requestedBy: opts?.requestedBy,
        });
        return { pendingApproval: true, approvalRequestId: approvalRequest.id, message: 'Sent for approval — the invoice will be created once approved.' };
      }
    }

    const invoice = this.invoiceRepo.create({
      customerId: dto.customerId,
      salesOrderId: dto.salesOrderId,
      quotationNumber: dto.quotationNumber,
      issueDate: this.todayStr(),
      dueDate: dto.dueDate,
      deliveryDate: dto.deliveryDate,
      subtotal,
      discountAmount,
      vatAmount,
      total,
      vatExcluded,
      paymentType: dto.paymentType,
      deliveryMethod: dto.deliveryMethod,
      template: dto.template || settings.defaultInvoiceTemplate,
      version: 1,
      invoiceNumber: 'PENDING', // replaced right after insert, once we know sequenceNumber
    });
    const saved = await this.invoiceRepo.save(invoice);

    const year = new Date().getFullYear();
    saved.invoiceNumber = `INV-${year}-${String(saved.sequenceNumber).padStart(4, '0')}`;
    await this.invoiceRepo.save(saved);

    const items = lineItems.map((i) =>
      this.itemRepo.create({
        invoiceId: saved.id,
        finishedGoodId: i['finishedGoodId'],
        description: i['description'],
        quantity: i.quantity,
        unit: i['unit'],
        unitPrice: i.unitPrice,
        vatRate: i.vatRate ?? 5,
        lineTotal: i.lineTotal,
      }),
    );
    await this.itemRepo.save(items);

    this.applyDeliveryRule(saved);
    await this.invoiceRepo.save(saved);
    await this.syncStock(saved, [], items, opts?.requestedBy);
    await this.recordShortages(saved, items);

    const pdfPath = await this.writePdfAndGetPath(saved, items, customer.name, customer.vatin, customer.address, customer.phone);
    saved.pdfPath = pdfPath;
    await this.invoiceRepo.save(saved);

    if (vatExcluded) {
      // Background: an SMTP failure must not stop the journal entry below.
      runInBackground('VAT excluded email', () => this.emailService.sendVatExcludedNotice(saved.invoiceNumber, customer.name, total));
      await this.activityLog.log({
        action: 'invoice.vat_excluded',
        entityType: 'invoice',
        entityId: saved.id,
        details: { invoiceNumber: saved.invoiceNumber, customerName: customer.name, total },
      });
    }

    await this.postJournalEntry(saved, opts?.requestedBy);
    return { ...saved, items };
  }

  // Edits an existing invoice.
  // - Same calendar day as issueDate -> overwrite PDF in place, version unchanged
  // - Different day -> version increments, previous PDF file is kept as-is
  async update(id: string, dto: UpdateInvoiceDto, opts?: { skipApprovalGates?: boolean; requestedBy?: { userId?: string; email?: string } }) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    this.assertNotOpening(invoice, 'edited');
    await this.journalPosting.assertDateOpen(invoice.issueDate, 'This invoice');

    // customerService.findOne throws NotFoundException if the id is bad,
    // which doubles as validation before we commit to the change.
    const customer = dto.customerId !== undefined
      ? await this.customerService.findOne(dto.customerId)
      : await this.customerService.findOne(invoice.customerId);

    const vatExcludedChanged = dto.vatExcluded !== undefined && dto.vatExcluded !== invoice.vatExcluded;
    const finalVatExcluded = dto.vatExcluded !== undefined ? dto.vatExcluded : invoice.vatExcluded;
    const discountChanged = dto.discountAmount !== undefined && Number(dto.discountAmount) !== Number(invoice.discountAmount);

    const existingItems = await this.itemRepo.find({ where: { invoiceId: id } });

    // Dry-run totals — nothing is written to the DB yet. Previously the
    // credit-limit check ran AFTER the new item rows were already saved,
    // so a blocked edit could leave the item rows out of sync with the
    // (unsaved, rolled-back-in-memory) invoice total. Computing everything
    // up front and gate-checking before any write fixes that.
    let calc: { lineItems: any[]; subtotal: number; discountAmount: number; vatAmount: number; total: number } | null = null;
    if (dto.items || vatExcludedChanged || discountChanged) {
      const itemsForCalc = dto.items
        ? (await this.units.resolveProductLines(dto.items)).map((i) => ({ ...i, vatRate: i.vatRate ?? 5 }))
        : existingItems.map((i) => ({ quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), vatRate: Number(i.vatRate) }));
      calc = this.calcTotals(itemsForCalc, finalVatExcluded, dto.discountAmount ?? Number(invoice.discountAmount));
    }
    const totalsForGateCheck = calc
      ? { subtotal: calc.subtotal, discountAmount: calc.discountAmount, total: calc.total }
      : { subtotal: Number(invoice.subtotal), discountAmount: Number(invoice.discountAmount), total: Number(invoice.total) };

    if (!opts?.skipApprovalGates) {
      // Exclude this invoice's own current (pre-edit) outstanding amount
      // from the customer's balance before adding the edited total back
      // in — otherwise an unchanged invoice would double-count itself
      // and could never be re-saved once a customer is near their limit.
      const gates = await this.evaluateApprovalGates(customer, totalsForGateCheck, finalVatExcluded, id);
      if (gates.length > 0) {
        if (!dto.requestApproval) {
          throw new BadRequestException({
            approvalRequired: true,
            gates,
            message: `This invoice needs approval: ${gates.map((g) => g.reason).join(' ')}`,
          });
        }
        const approvalRequest = await this.approvalService.create({
          type: gates[0].type,
          entityType: 'invoice',
          targetId: id,
          customerId: customer.id,
          payload: dto,
          reason: gates.map((g) => g.reason).join(' '),
          requestedBy: opts?.requestedBy,
        });
        return { pendingApproval: true, approvalRequestId: approvalRequest.id, message: 'Sent for approval — changes will apply once approved.' };
      }
    }

    // Items/amounts can't change once a sales return was approved against
    // this invoice - the return's credit note and refund are based on them.
    if ((dto.items || discountChanged || vatExcludedChanged) && (await this.hasApprovedReturns(id))) {
      throw new BadRequestException('This invoice has an approved sales return, so its items and amounts can no longer be changed.');
    }

    // Nothing blocks (or this is a trusted replay from an approved
    // request) — apply for real.
    if (dto.customerId !== undefined) invoice.customerId = dto.customerId;
    if (dto.quotationNumber !== undefined) invoice.quotationNumber = dto.quotationNumber;
    if (dto.dueDate !== undefined) invoice.dueDate = dto.dueDate;
    if (dto.deliveryDate !== undefined) invoice.deliveryDate = dto.deliveryDate;
    if (dto.paymentType !== undefined) invoice.paymentType = dto.paymentType;
    if (dto.deliveryMethod !== undefined) invoice.deliveryMethod = dto.deliveryMethod;
    if (dto.template !== undefined) invoice.template = dto.template;
    if (dto.vatExcluded !== undefined) invoice.vatExcluded = dto.vatExcluded;
    this.applyDeliveryRule(invoice);

    let items = existingItems;
    if (calc) {
      if (dto.items) {
        // Replace all line items with the edited set.
        await this.itemRepo.remove(existingItems);
        items = await this.itemRepo.save(
          calc.lineItems.map((i) =>
            this.itemRepo.create({
              invoiceId: id,
              finishedGoodId: i['finishedGoodId'],
              description: i['description'],
              quantity: i.quantity,
              unit: i['unit'],
              unitPrice: i.unitPrice,
              vatRate: i.vatRate ?? 5,
              lineTotal: i.lineTotal,
            }),
          ),
        );
      }
      invoice.subtotal = calc.subtotal;
      invoice.discountAmount = calc.discountAmount;
      invoice.vatAmount = calc.vatAmount;
      invoice.total = calc.total;
    }

    if (dto.items) {
      await this.invoiceRepo.save(invoice);
      await this.syncStock(invoice, existingItems, items, opts?.requestedBy);
      await this.recordShortages(invoice, items);
    }

    // The total may have just changed — re-check it against whatever is
    // already recorded in the Payment Ledger (paidAmount is untouched by
    // an edit) so the status badge stays correct either way.
    invoice.paymentStatus = computePaymentStatus(Number(invoice.paidAmount || 0), Number(invoice.total));

    const isSameDay = invoice.issueDate === this.todayStr();
    if (!isSameDay) {
      invoice.version += 1;
    }

    const pdfPath = await this.writePdfAndGetPath(invoice, items, customer.name, customer.vatin, customer.address, customer.phone);
    invoice.pdfPath = pdfPath;
    await this.invoiceRepo.save(invoice);

    if (vatExcludedChanged && invoice.vatExcluded) {
      // Background: an SMTP failure must not stop the journal entry below.
      runInBackground('VAT excluded email', () =>
        this.emailService.sendVatExcludedNotice(invoice.invoiceNumber, customer.name, Number(invoice.total)),
      );
      await this.activityLog.log({
        action: 'invoice.vat_excluded',
        entityType: 'invoice',
        entityId: invoice.id,
        details: { invoiceNumber: invoice.invoiceNumber, customerName: customer.name, total: Number(invoice.total) },
      });
    }

    await this.postJournalEntry(invoice, opts?.requestedBy);
    return { ...invoice, items };
  }

  // Replays a stored ApprovalRequest's payload once someone with the
  // right role approves it — either a brand-new invoice (targetId unset)
  // or an edit to an existing one. skipApprovalGates:true means this
  // trusted replay never re-blocks on the same gate it was created for.
  async applyApprovedInvoiceRequest(approvalRequestId: string, approvedBy?: { userId?: string; email?: string }) {
    const request = await this.approvalService.claimPending(approvalRequestId, 'invoice');
    const payload = JSON.parse(request.payload);
    const result = request.targetId
      ? await this.update(request.targetId, payload, { skipApprovalGates: true })
      : await this.create(payload, { skipApprovalGates: true });
    await this.approvalService.markDecided(approvalRequestId, ApprovalRequestStatus.APPROVED, approvedBy);
    return result;
  }

  async rejectInvoiceApprovalRequest(approvalRequestId: string, decidedBy?: { userId?: string; email?: string }) {
    return this.approvalService.reject(approvalRequestId, 'invoice', decidedBy);
  }

  // Builds a wa.me link so the invoice can be sent to the customer with
  // one click — no paid WhatsApp API involved.
  async getWhatsappLink(id: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const customer = await this.customerService.findOne(invoice.customerId);
    if (!customer.phone) {
      throw new BadRequestException('This customer has no phone number on file');
    }
    const phone = toWhatsappPhone(customer.phone);
    const pdfUrl = invoice.pdfPath ? this.documentLinks.createUrl('invoice', invoice.id) : null;
    const message = `Hello ${customer.name}, your invoice ${invoice.invoiceNumber} totalling ${invoice.total} OMR is ready.`
      + (pdfUrl ? `\n\nView / download PDF:\n${pdfUrl}` : '');
    return buildWhatsappLinks(phone, message);
  }

  // One-click: invoice -> delivery note, carrying over customer, items,
  // payment terms and delivery method. Unlike quotation->invoice this
  // doesn't lock the invoice (an invoice can spawn more than one
  // delivery note, e.g. partial/staged deliveries against one invoice).
  async convertToDeliveryNote(id: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    this.assertNotOpening(invoice, 'turned into a delivery note');
    const items = await this.itemRepo.find({ where: { invoiceId: id } });

    return this.deliveryNoteService.create({
      customerId: invoice.customerId,
      invoiceNumber: invoice.invoiceNumber,
      paymentType: invoice.paymentType,
      deliveryMethod: invoice.deliveryMethod,
      discountAmount: Number(invoice.discountAmount || 0),
      items: items.map((i) => ({
        finishedGoodId: i.finishedGoodId,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPrice: Number(i.unitPrice),
        vatRate: Number(i.vatRate),
      })),
    });
  }

  async getPdfPath(id: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.isOpening) throw new NotFoundException('This is an opening balance from the old books - its PDF is in the old system.');
    if (!invoice.pdfPath) throw new NotFoundException('No PDF generated yet for this invoice');
    return invoice.pdfPath;
  }

  // Admin-only (enforced at the controller). Removes the invoice, its
  // line items, and its saved PDF file(s) on disk.
  async remove(id: string, deletedBy?: { userId?: string; email?: string }) {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    this.assertNotOpening(invoice, 'deleted');
    await this.journalPosting.assertDateOpen(invoice.issueDate, 'This invoice');
    if (await this.hasApprovedReturns(id)) {
      throw new BadRequestException('This invoice has an approved sales return and cannot be deleted.');
    }
    const items = await this.itemRepo.find({ where: { invoiceId: id } });
    // put the goods back in stock (and remove its cost of goods sold)
    await this.syncStock(invoice, items, [], deletedBy);
    if (items.length > 0) await this.itemRepo.remove(items);
    await this.invoicePaymentService.removeAllForInvoice(id);
    if (invoice.pdfPath && fs.existsSync(invoice.pdfPath)) {
      try { fs.unlinkSync(invoice.pdfPath); } catch { /* file cleanup is best-effort */ }
    }
    await this.invoiceRepo.remove(invoice);
    await this.activityLog.log({
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: id,
      userId: deletedBy?.userId,
      userEmail: deletedBy?.email,
      details: { invoiceNumber: invoice.invoiceNumber, total: Number(invoice.total) },
    });
    try {
      await this.journalPosting.removeForSource('invoice', id);
    } catch (err) {
      console.error(`Removing auto-posted journal entry failed for invoice ${id}:`, err);
    }
    return { deleted: true };
  }

  // Undo of a deleted invoice (Activity Log > Deleted): puts the invoice
  // and its lines back with their original ids/numbers, then re-applies
  // what the delete reversed - stock out (and waiting-for-stock), cost of
  // goods sold, the sales journal entry, the PDF, and each payment
  // (re-deposited on its bank/cash account when it had one).
  async restoreDeleted(rows: { entity: string; data: Record<string, unknown> }[], actor: ActorRef = {}) {
    const invRow = rows.find((r) => r.entity === 'Invoice');
    if (!invRow) throw new BadRequestException('Nothing to restore for this invoice.');
    const itemRows = rows.filter((r) => r.entity === 'InvoiceItem');
    const paymentRows = rows.filter((r) => r.entity === 'InvoicePayment' && !r.data.salesReturnId);
    const toDate = (v: unknown) => (typeof v === 'string' ? new Date(v) : v);

    await this.dataSource.transaction(async (manager) => {
      const data = { ...invRow.data };
      delete data.sequenceNumber;
      await manager.insert(Invoice, {
        ...data,
        createdAt: toDate(data.createdAt),
        updatedAt: new Date(),
        deliveredAt: toDate(data.deliveredAt),
        stockReadyAt: toDate(data.stockReadyAt),
        cogsAmount: 0,
        paidAmount: 0,
        paymentStatus: computePaymentStatus(0, Number(data.total)),
        pdfPath: null,
        waitingForStock: false,
      } as any);
      for (const r of itemRows) await manager.insert(InvoiceItem, { ...r.data, shortQuantity: 0 } as any);
    });

    const invoice = await this.invoiceRepo.findOne({ where: { id: String(invRow.data.id) } });
    if (!invoice) throw new NotFoundException('Restored invoice not found');
    const items = await this.itemRepo.find({ where: { invoiceId: invoice.id } });
    await this.syncStock(invoice, [], items, actor);
    await this.recordShortages(invoice, items);
    const customer = await this.customerService.findOne(invoice.customerId);
    invoice.pdfPath = await this.writePdfAndGetPath(invoice, items, customer.name, customer.vatin, customer.address, customer.phone);
    await this.invoiceRepo.update({ id: invoice.id }, { pdfPath: invoice.pdfPath });
    await this.postJournalEntry(invoice, actor);

    for (const p of paymentRows) {
      const d = p.data;
      let bankAccountId = (d.bankAccountId as string) || undefined;
      if (bankAccountId) {
        const exists = await this.dataSource.query('SELECT id FROM bank_accounts WHERE id = ?', [bankAccountId]).catch(() => []);
        if (!exists.length) bankAccountId = undefined;
      }
      await this.invoicePaymentService.create(
        invoice.id,
        {
          amount: Number(d.amount),
          paymentType: (d.paymentType as any) || undefined,
          paymentDate: (d.paymentDate as string) || undefined,
          note: (d.note as string) || undefined,
          bankAccountId,
        } as any,
        actor,
      );
    }
    return invoice;
  }

  // Used by the Accounting module for revenue summaries — total invoiced
  // amounts (subtotal/VAT/total) issued within a date range.
  async getTotalsInRange(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .getMany();

    let subtotal = 0;
    let vatAmount = 0;
    let total = 0;
    for (const inv of invoices) {
      subtotal += Number(inv.subtotal);
      vatAmount += Number(inv.vatAmount);
      total += Number(inv.total);
    }
    return { subtotal, vatAmount, total, count: invoices.length };
  }

  // Groups invoiced revenue by customer for a date range — used by the
  // Reports page's "Customer-wise Sales Breakdown".
  async getCustomerBreakdownInRange(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .getMany();

    const byCustomer = new Map<string, { customerId: string; total: number; count: number }>();
    for (const inv of invoices) {
      const existing = byCustomer.get(inv.customerId);
      if (existing) {
        existing.total += Number(inv.total);
        existing.count += 1;
      } else {
        byCustomer.set(inv.customerId, { customerId: inv.customerId, total: Number(inv.total), count: 1 });
      }
    }
    return Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);
  }

  // Revenue per calendar month for the last N months (oldest first) —
  // used by the Reports page's monthly trend chart.
  async getMonthlyTrend(monthsBack: number) {
    const now = new Date();
    const months: { year: number; month: number; label: string; startDate: string; endDate: string }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-indexed
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      months.push({ year, month, label, startDate, endDate });
    }

    const results: { label: string; total: number; count: number }[] = [];
    for (const m of months) {
      const { total, count } = await this.getTotalsInRange(m.startDate, m.endDate);
      results.push({ label: m.label, total, count });
    }
    return results;
  }

  // Revenue grouped by calendar day within a date range — used by the
  // Dashboard's Sales vs Expenses daily trend chart.
  async getDailyRevenue(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .getMany();

    const byDate = new Map<string, number>();
    for (const inv of invoices) {
      byDate.set(inv.issueDate, (byDate.get(inv.issueDate) || 0) + Number(inv.total));
    }
    return byDate;
  }

  // Sales Tax (Output VAT) report — every invoice issued within a date
  // range, its own subtotal/vatAmount/total broken out. Customer names
  // are attached by ReportingService (same split as getCustomerBreakdownInRange).
  // Output VAT for a period (Oman VAT return, sales side):
  //  - taxable value is AFTER the discount (VAT is charged on the
  //    discounted price);
  //  - approved sales returns in the period (credit notes) are deducted.
  async getSalesTaxReport(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .orderBy('invoice.issueDate', 'ASC')
      .getMany();
    const returns = await this.dataSource
      .getRepository(SalesReturn)
      .createQueryBuilder('r')
      .where('r.status = :status', { status: SalesReturnStatus.APPROVED })
      .andWhere('r.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    const returnInvoices = returns.length ? await this.invoiceRepo.find({ where: { id: In(returns.map((r) => r.invoiceId)) } }) : [];

    const rows = [
      ...invoices.map((inv) => {
        const taxable = this.round3(Number(inv.subtotal || 0) - Number(inv.discountAmount || 0));
        return {
          type: 'invoice' as const,
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerId: inv.customerId,
          issueDate: inv.issueDate,
          grossAmount: Number(inv.subtotal || 0),
          discountAmount: Number(inv.discountAmount || 0),
          subtotal: taxable, // taxable value (after discount)
          vatAmount: Number(inv.vatAmount || 0),
          total: Number(inv.total || 0),
          vatExcluded: !!inv.vatExcluded,
        };
      }),
      ...returns.map((r) => ({
        type: 'credit_note' as const,
        id: r.id,
        invoiceNumber: `${r.returnNumber} (credit note for ${returnInvoices.find((i) => i.id === r.invoiceId)?.invoiceNumber || 'invoice'})`,
        customerId: r.customerId,
        issueDate: r.date,
        grossAmount: -Number(r.subtotal || 0),
        discountAmount: 0,
        subtotal: -Number(r.subtotal || 0),
        vatAmount: -Number(r.vatAmount || 0),
        total: -Number(r.total || 0),
        vatExcluded: false,
      })),
    ].sort((a, b) => (a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : 0));
    const totalTaxableSales = this.round3(rows.reduce((sum, r) => sum + r.subtotal, 0));
    const totalVat = this.round3(rows.reduce((sum, r) => sum + r.vatAmount, 0));
    return {
      period: { startDate, endDate },
      rows,
      totalTaxableSales,
      totalVat,
      creditNotesVat: this.round3(returns.reduce((s, r) => s + Number(r.vatAmount || 0), 0)),
      invoiceCount: invoices.length,
    };
  }


  // Sales Tax — "Category Based" card. This system has a single product
  // line (no product-category field), so the accounting-meaningful
  // grouping for an Oman VAT return is by VAT rate instead: Standard
  // (5%), Zero-rated (0%) and Exempt — whichever rates actually appear
  // on invoice lines within the range.
  async getSalesTaxByVatRate(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .getMany();
    const returns = await this.dataSource
      .getRepository(SalesReturn)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.items', 'items')
      .where('r.status = :status', { status: SalesReturnStatus.APPROVED })
      .andWhere('r.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    const byRate = new Map<number, { vatRate: number; taxableAmount: number; vatAmount: number }>();
    const add = (rate: number, taxable: number, vat: number) => {
      const existing = byRate.get(rate) || { vatRate: rate, taxableAmount: 0, vatAmount: 0 };
      existing.taxableAmount += taxable;
      existing.vatAmount += vat;
      byRate.set(rate, existing);
    };

    if (invoices.length) {
      const items = await this.itemRepo.find({ where: { invoiceId: In(invoices.map((i) => i.id)) } });
      for (const inv of invoices) {
        // same pro-rata discount split the invoice used; VAT-excluded
        // invoices carry no VAT at all
        const lines = items.filter((i) => i.invoiceId === inv.id);
        const sub = Number(inv.subtotal || 0);
        const factor = sub > 0 ? (sub - Number(inv.discountAmount || 0)) / sub : 1;
        for (const line of lines) {
          const rate = inv.vatExcluded ? 0 : Number(line.vatRate);
          const taxable = this.round3(Number(line.lineTotal) * factor);
          add(rate, taxable, this.round3((taxable * rate) / 100));
        }
      }
    }
    // credit notes reduce the same rate bucket
    for (const r of returns) {
      const hasVat = Number(r.vatAmount || 0) > 0;
      const sub = (r.items || []).reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
      for (const i of r.items || []) {
        const rate = hasVat ? Number(i.vatRate) : 0;
        const share = sub > 0 ? (Number(i.quantity) * Number(i.unitPrice)) / sub : 0;
        const taxable = this.round3(Number(r.subtotal) * share);
        add(rate, -taxable, -this.round3((taxable * rate) / 100));
      }
    }
    const rows = Array.from(byRate.values())
      .map((r) => ({
        vatRate: r.vatRate,
        label: r.vatRate === 0 ? 'Zero-rated / Exempt / VAT excluded (0%)' : `Standard Rate (${r.vatRate}%)`,
        taxableAmount: this.round3(r.taxableAmount),
        vatAmount: this.round3(r.vatAmount),
      }))
      .sort((a, b) => b.vatRate - a.vatRate);
    return {
      rows,
      totalTaxableSales: this.round3(rows.reduce((s, r) => s + r.taxableAmount, 0)),
      totalVat: this.round3(rows.reduce((s, r) => s + r.vatAmount, 0)),
    };
  }


  // Product Sales report — revenue grouped by product (finishedGoodId)
  // across every invoice issued within a date range. Free-text lines with
  // no linked product are grouped separately by their description text
  // (keyed distinctly so two different free-text lines never merge).
  async getProductSalesBreakdown(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // opening balances (old books) are not sales of this period
      .andWhere('invoice.isOpening = :opening', { opening: false })
      .getMany();
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length === 0) return [];
    const items = await this.itemRepo.find({ where: { invoiceId: In(invoiceIds) } });

    const byProduct = new Map<string, { finishedGoodId: string | null; description: string; quantity: number; total: number }>();
    for (const item of items) {
      const key = item.finishedGoodId || `text:${item.description}`;
      const existing = byProduct.get(key);
      if (existing) {
        existing.quantity += Number(item.quantity);
        existing.total += Number(item.lineTotal);
      } else {
        byProduct.set(key, {
          finishedGoodId: item.finishedGoodId || null,
          description: item.description,
          quantity: Number(item.quantity),
          total: Number(item.lineTotal),
        });
      }
    }
    return Array.from(byProduct.values())
      .map((r) => ({ ...r, quantity: this.round3(r.quantity), total: this.round3(r.total) }))
      .sort((a, b) => b.total - a.total);
  }

  // Accounts Receivable Aging Report — every invoice with an outstanding
  // balance (paymentStatus 'due' or 'partial'), grouped by customer and
  // bucketed by how many days overdue it is (measured from dueDate; an
  // invoice with no dueDate falls back to issueDate). ReportingService
  // attaches customer names on top of this — kept customerId-only here
  // since InvoiceService shouldn't depend on CustomerService for a report.
  async getAgingReportRows(): Promise<CustomerAging[]> {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.paymentStatus != :paid', { paid: 'paid' })
      .getMany();

    const today = new Date(this.todayStr());
    const byCustomer = new Map<string, CustomerAging>();

    for (const inv of invoices) {
      const outstanding = this.round3(Number(inv.total) - Number(inv.paidAmount || 0));
      if (outstanding <= 0) continue; // fully paid but status hasn't caught up yet (shouldn't normally happen)

      const referenceDate = new Date(inv.dueDate || inv.issueDate);
      const daysOverdue = Math.floor((today.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));

      let bucket: AgingBucket;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = 'days1to30';
      else if (daysOverdue <= 60) bucket = 'days31to60';
      else if (daysOverdue <= 90) bucket = 'days61to90';
      else bucket = 'days90plus';

      const existing = byCustomer.get(inv.customerId) || {
        customerId: inv.customerId,
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90plus: 0,
        totalOutstanding: 0,
        oldestDaysOverdue: 0,
      };
      existing[bucket] = this.round3(existing[bucket] + outstanding);
      existing.totalOutstanding = this.round3(existing.totalOutstanding + outstanding);
      existing.oldestDaysOverdue = Math.max(existing.oldestDaysOverdue, daysOverdue);
      byCustomer.set(inv.customerId, existing);
    }

    return Array.from(byCustomer.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  // Dashboard's "Overdue Invoices" list — one row per overdue invoice
  // (not grouped by customer like getAgingReportRows() above), for a
  // simple scannable list. "Overdue" = outstanding balance AND past its
  // due date (an unpaid invoice not yet due is not shown here — that's
  // just normal AR, not a problem to flag).
  async getOverdueInvoicesList(limit = 10) {
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.paymentStatus != :paid', { paid: 'paid' })
      .getMany();

    const today = this.todayStr();
    const rows = invoices
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerId: inv.customerId,
        dueDate: inv.dueDate,
        outstanding: this.round3(Number(inv.total) - Number(inv.paidAmount || 0)),
      }))
      .filter((r) => r.outstanding > 0.001 && r.dueDate && r.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)); // oldest due date first
    return rows.slice(0, limit);
  }

  // Customer Statement of Account for a date range — Opening Balance
  // (everything before startDate, net), every invoice/payment that falls
  // inside [startDate, endDate] with a running balance, and a Closing
  // Balance. Regenerated fresh on every request rather than saved to
  // disk, since the date range changes each time it's requested.
  async generateCustomerStatement(customerId: string, startDate: string, endDate: string) {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are both required (YYYY-MM-DD).');
    }
    const customer = await this.customerService.findOne(customerId);

    // Every invoice issued up to endDate — needed both for the Opening
    // Balance (issued before startDate) and the in-range transaction rows.
    const invoices = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.customerId = :customerId', { customerId })
      .andWhere('invoice.issueDate <= :endDate', { endDate })
      .orderBy('invoice.issueDate', 'ASC')
      .getMany();

    const invoiceIds = invoices.map((inv) => inv.id);
    const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
    const payments = await this.invoicePaymentService.findByInvoiceIds(invoiceIds);
    const paymentsUpToEnd = payments.filter((p) => p.paymentDate <= endDate);

    let openingBalance = 0;
    for (const inv of invoices) {
      if (inv.issueDate < startDate) openingBalance += Number(inv.total);
    }
    for (const p of paymentsUpToEnd) {
      if (p.paymentDate < startDate) openingBalance -= Number(p.amount);
    }
    openingBalance = this.round3(openingBalance);

    type SortableTxn = StatementTransaction & { sortKey: string };
    const transactions: SortableTxn[] = [];

    for (const inv of invoices) {
      if (inv.issueDate >= startDate && inv.issueDate <= endDate) {
        transactions.push({
          date: inv.issueDate,
          type: 'invoice',
          reference: inv.invoiceNumber,
          description: `Invoice ${inv.invoiceNumber}`,
          debit: Number(inv.total),
          credit: 0,
          sortKey: `${inv.issueDate}_0_${inv.invoiceNumber}`,
        });
      }
    }
    for (const p of paymentsUpToEnd) {
      if (p.paymentDate >= startDate && p.paymentDate <= endDate) {
        const inv = invoiceById.get(p.invoiceId);
        transactions.push({
          date: p.paymentDate,
          type: 'payment',
          reference: inv?.invoiceNumber || '-',
          description: p.salesReturnId
            ? `Credit note (sales return)${inv ? ' — ' + inv.invoiceNumber : ''}`
            : `Payment received${inv ? ' — ' + inv.invoiceNumber : ''}`,
          debit: 0,
          credit: Number(p.amount),
          sortKey: `${p.paymentDate}_1_${inv?.invoiceNumber || ''}`,
        });
      }
    }
    transactions.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let closingBalance = openingBalance;
    for (const t of transactions) closingBalance = this.round3(closingBalance + t.debit - t.credit);

    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();

    const buffer = await generateStatementPdf({
      customerName: customer.name,
      customerAddress: customer.address,
      customerPhone: customer.phone,
      customerVatin: customer.vatin,
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || this.config.get('COMPANY_VATIN') || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      startDate,
      endDate,
      openingBalance,
      transactions: transactions.map(({ sortKey, ...t }) => t),
      closingBalance,
      logoBase64,
    });

    return { buffer, customerName: customer.name };
  }
}
