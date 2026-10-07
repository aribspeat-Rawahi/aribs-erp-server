import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SalesReturn, SalesReturnStatus } from './sales-return.entity';
import { SalesReturnItem } from './sales-return-item.entity';
import { Invoice } from './invoice.entity';
import { InvoiceItem } from './invoice-item.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { BankTransaction, BankTransactionType } from '../bank-account/bank-transaction.entity';
import { CreateSalesReturnDto } from './dto/sales-return.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { assertQuantityForUnit } from '../units/units';
import { InvoicePayment } from './invoice-payment.entity';
import { computePaymentStatus } from './payment-status.util';
import { BackorderService } from '../stock-alerts/backorder.service';
import { CustomerService } from '../customer/customer.service';
import { SettingsService } from '../settings/settings.service';
import { generateInvoicePdf } from '../common/invoice-pdf.util';

interface ActorRef {
  userId?: string;
  email?: string;
}

const SALES_RETURN_CODE = '1403'; // Sales Returns and Allowance
// VAT Payable, not "1407 Sales Return Tax" — the returned VAT was never
// part of Sales Revenue (the original invoice credited it straight to
// 2100), so reversing it here has to reduce that same liability, not a
// Revenue-type account (which would incorrectly shrink reported Revenue
// by the VAT amount too).
const VAT_PAYABLE_CODE = '2100';
const ACCOUNTS_RECEIVABLE_CODE = '1100';
const FG_INVENTORY_CODE = '1210';
const COGS_CODE = '500';

@Injectable()
export class SalesReturnService {
  constructor(
    @InjectRepository(SalesReturn)
    private repo: Repository<SalesReturn>,
    @InjectRepository(InvoiceItem)
    private invoiceItemRepo: Repository<InvoiceItem>,
    @InjectDataSource()
    private dataSource: DataSource,
    private activityLog: ActivityLogService,
    private bankAccountService: BankAccountService,
    private journalPosting: JournalPostingService,
    private batchTrackingService: BatchTrackingService,
    private backorders: BackorderService,
    private customerService: CustomerService,
    private settingsService: SettingsService,
  ) {}

  private generateReturnNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `SR-${date}-${rand}`;
  }

  // unit costs keep 6 decimals (amounts 3)
  private round6(n: number) {
    return Math.round(n * 1e6) / 1e6;
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  findAll() {
    return this.repo.find({ relations: ['items'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  // Total of APPROVED sales returns within a date range — the Dashboard's
  // Sales card "Return Amount" figure. Pending/rejected returns have no
  // real stock/money effect yet, so they're excluded.
  async getApprovedTotalInRange(startDate: string, endDate: string) {
    const rows = await this.repo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: SalesReturnStatus.APPROVED })
      .andWhere('r.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    return this.round3(rows.reduce((sum, r) => sum + Number(r.total), 0));
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id }, relations: ['items'] });
    if (!item) throw new NotFoundException('Sales return not found');
    return item;
  }

  // Approved AND pending returns count, so two open returns can't both
  // claim the same goods.
  private async alreadyReturnedQty(invoiceId: string, finishedGoodId: string) {
    const returns = await this.repo.find({
      where: { invoiceId, status: In([SalesReturnStatus.APPROVED, SalesReturnStatus.PENDING]) },
      relations: ['items'],
    });
    let qty = 0;
    for (const r of returns) {
      for (const i of r.items) {
        if (i.finishedGoodId === finishedGoodId) qty += Number(i.quantity);
      }
    }
    return qty;
  }

  async create(dto: CreateSalesReturnDto, requestedBy: ActorRef) {
    const invoice = await this.dataSource.manager.findOne(Invoice, { where: { id: dto.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const finishedGoodIds = dto.items.map((i) => i.finishedGoodId);
    const invoiceItems = await this.invoiceItemRepo.find({
      where: { invoiceId: invoice.id, finishedGoodId: In(finishedGoodIds) },
    });
    // An invoice can carry the same product on more than one line —
    // combine them so the returnable quantity check looks at the whole
    // invoice, not just the first matching line.
    const originalQtyByProduct = new Map<string, number>();
    const referenceItemByProduct = new Map<string, InvoiceItem>();
    for (const ii of invoiceItems) {
      if (!ii.finishedGoodId) continue;
      originalQtyByProduct.set(ii.finishedGoodId, (originalQtyByProduct.get(ii.finishedGoodId) || 0) + Number(ii.quantity));
      if (!referenceItemByProduct.has(ii.finishedGoodId)) referenceItemByProduct.set(ii.finishedGoodId, ii);
    }

    // Return value per line = qty x the invoice's unit price, less this
    // line's share of the invoice discount (same pro-rata rule the invoice
    // used), plus VAT at the line's rate - no VAT if the invoice was VAT
    // excluded. `subtotal` here is the net (after discount) amount.
    const invoiceSubtotal = Number(invoice.subtotal);
    const netFactor = invoiceSubtotal > 0 ? (invoiceSubtotal - Number(invoice.discountAmount || 0)) / invoiceSubtotal : 1;
    let subtotal = 0;
    let vatAmount = 0;
    const itemRows: { finishedGoodId: string; quantity: number; unit: string; unitPrice: number; vatRate: number }[] = [];
    for (const line of dto.items) {
      const reference = referenceItemByProduct.get(line.finishedGoodId);
      if (!reference) {
        throw new BadRequestException(`This invoice has no line for the selected product (${line.finishedGoodId})`);
      }
      const alreadyReturned = await this.alreadyReturnedQty(invoice.id, line.finishedGoodId);
      const remaining = this.round3((originalQtyByProduct.get(line.finishedGoodId) || 0) - alreadyReturned);
      if (Number(line.quantity) > remaining + 0.001) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${remaining} of this product remains returnable on this invoice.`,
        );
      }
      assertQuantityForUnit(line.quantity, reference.unit, reference.description);
      const lineNet = this.round3(Number(line.quantity) * Number(reference.unitPrice) * netFactor);
      subtotal += lineNet;
      if (!invoice.vatExcluded) vatAmount += this.round3((lineNet * Number(reference.vatRate)) / 100);
      itemRows.push({
        finishedGoodId: line.finishedGoodId,
        quantity: Number(line.quantity),
        unit: reference.unit,
        unitPrice: Number(reference.unitPrice),
        vatRate: Number(reference.vatRate),
      });
    }
    subtotal = this.round3(subtotal);
    vatAmount = this.round3(vatAmount);
    if (itemRows.length === 0) throw new BadRequestException('Add at least one item to return');

    const item = this.repo.create({
      returnNumber: this.generateReturnNumber(),
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      status: SalesReturnStatus.PENDING,
      date: dto.date || new Date().toISOString().slice(0, 10),
      reason: dto.reason,
      subtotal,
      vatAmount,
      total: this.round3(subtotal + vatAmount),
      requestedByUserId: requestedBy.userId,
      requestedByEmail: requestedBy.email,
      items: itemRows.map((i) => this.repo.manager.create(SalesReturnItem, i)),
    });
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'sales_return.created',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: requestedBy.userId,
      userEmail: requestedBy.email,
      details: { returnNumber: saved.returnNumber, invoiceId: saved.invoiceId, total: saved.total },
    });
    return saved;
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    if (item.status !== SalesReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be deleted (this one is ${item.status})`);
    }
    // items removed explicitly (not left to the DB cascade) so they are
    // kept with the delete record and come back on "Undo"
    if (item.items?.length) await this.repo.manager.remove(item.items);
    item.items = [];
    await this.repo.remove(item);
    return { deleted: true };
  }

  // How an approval would settle the money: first it lowers what the
  // customer still owes on the invoice (credit note), the rest - only if
  // they had already paid more than that - is paid back from a bank/cash
  // account.
  async getSettlement(id: string) {
    const item = await this.findOne(id);
    const invoice = await this.dataSource.manager.findOne(Invoice, { where: { id: item.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { ...this.splitSettlement(Number(item.total), invoice), invoiceNumber: invoice.invoiceNumber };
  }

  private splitSettlement(total: number, invoice: Invoice) {
    const outstanding = this.round3(Math.max(0, Number(invoice.total) - Number(invoice.paidAmount || 0)));
    const appliedToInvoice = this.round3(Math.min(total, outstanding));
    const refundAmount = this.round3(total - appliedToInvoice);
    return { total, outstanding, appliedToInvoice, refundAmount, refundAccountRequired: refundAmount > 0.0005 };
  }

  // Approve & add to stock:
  //  - goods go back into stock (new traceable batch; any part that fills
  //    invoices waiting for stock goes straight out to them);
  //  - credit note: the applied part is recorded on the invoice as a
  //    credit (an invoice_payments row with salesReturnId, no money moves),
  //    so its balance due drops;
  //  - refund: the rest is withdrawn from the chosen bank/cash account;
  //  - one journal entry: Dr Sales Returns (net) + Dr VAT Payable,
  //    Cr Accounts Receivable (applied) + Cr Bank (refund), plus the cost
  //    of goods sold reversal (Dr Finished Goods / Cr COGS).
  // All stock/money writes happen in one DB transaction.
  async approve(id: string, decidedBy: ActorRef, opts: { bankAccountId?: string } = {}) {
    let totalCost = 0;
    const productIds: string[] = [];
    let invoiceNumber = '';
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(SalesReturn, { where: { id }, relations: ['items'], lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('Sales return not found');
      if (item.status !== SalesReturnStatus.PENDING) {
        throw new BadRequestException(`Only pending returns can be approved (this one is ${item.status})`);
      }
      const invoice = await manager.findOne(Invoice, { where: { id: item.invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      invoiceNumber = invoice.invoiceNumber;

      const total = Number(item.total);
      const { appliedToInvoice, refundAmount } = this.splitSettlement(total, invoice);
      // the refund account is chosen by the approver, not the requester
      const refundAccountId = opts.bankAccountId;
      if (refundAmount > 0.0005 && !refundAccountId) {
        throw new BadRequestException(
          `The customer has already paid for these goods - choose the bank/cash account to refund ${refundAmount.toFixed(3)} OMR from.`,
        );
      }

      // what each product cost when it was sold on this invoice
      const soldItems = await manager.find(InvoiceItem, { where: { invoiceId: invoice.id } });
      for (const line of item.items) {
        const good = await manager.findOne(FinishedGood, {
          where: { id: line.finishedGoodId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!good) throw new NotFoundException('Product not found');
        // Cost of Goods Sold reversal at the cost the SALE used (saved on
        // the invoice line), so inventory and COGS reverse exactly what was
        // posted. Older lines without it fall back to the current cost.
        const sold = soldItems.find((i) => i.finishedGoodId === line.finishedGoodId && i.unitCost !== null && i.unitCost !== undefined);
        const unitCost = sold ? Number(sold.unitCost) : Number(good.costPerUnit);
        const qty = Number(line.quantity);
        totalCost += qty * unitCost;
        const before = Number(good.quantityInStock);
        // blend the returned units into the weighted-average cost
        const onHand = Math.max(0, before);
        if (onHand + qty > 0) good.costPerUnit = this.round6((onHand * Number(good.costPerUnit) + qty * unitCost) / (onHand + qty));
        good.quantityInStock = this.round3(before + Number(line.quantity));
        await manager.save(good);
        await this.batchTrackingService.createFinishedGoodBatch(manager, {
          finishedGoodId: good.id,
          quantity: Number(line.quantity),
          source: BatchSource.MANUAL,
        });
        await this.batchTrackingService.absorbBackorder(manager, good.id, before, Number(line.quantity));
        productIds.push(good.id);
      }
      totalCost = this.round3(totalCost);

      // credit note on the invoice
      if (appliedToInvoice > 0.0005) {
        await manager.save(
          manager.create(InvoicePayment, {
            invoiceId: invoice.id,
            amount: appliedToInvoice,
            paymentDate: item.date,
            note: `Credit note - sales return ${item.returnNumber}`,
            salesReturnId: item.id,
          }),
        );
        invoice.paidAmount = this.round3(Number(invoice.paidAmount || 0) + appliedToInvoice);
        invoice.paymentStatus = computePaymentStatus(invoice.paidAmount, Number(invoice.total));
        await manager.save(invoice);
      }

      // refund of what was already paid
      let bankTransactionId: string | undefined;
      if (refundAmount > 0.0005) {
        const account = await manager.findOne(BankAccount, {
          where: { id: refundAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!account) throw new NotFoundException('Bank/cash account not found');
        if (Number(account.currentBalance) < refundAmount) {
          throw new BadRequestException(`Insufficient balance in ${account.name} to refund ${refundAmount.toFixed(3)} OMR.`);
        }
        account.currentBalance = this.round3(Number(account.currentBalance) - refundAmount);
        await manager.save(account);
        const txn = await manager.save(
          manager.create(BankTransaction, {
            bankAccountId: account.id,
            type: BankTransactionType.WITHDRAWAL,
            amount: refundAmount,
            date: item.date,
            note: `Sales return refund — ${item.returnNumber}`,
          }),
        );
        bankTransactionId = txn.id;
      }

      item.status = SalesReturnStatus.APPROVED;
      item.appliedToInvoice = appliedToInvoice;
      item.refundAmount = refundAmount;
      item.bankAccountId = refundAmount > 0.0005 ? refundAccountId : undefined;
      item.bankTransactionId = bankTransactionId;
      item.decidedByUserId = decidedBy.userId;
      item.decidedByEmail = decidedBy.email;
      item.decidedAt = new Date();
      return manager.save(item);
    });

    await this.activityLog.log({
      action: 'sales_return.approved',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: {
        returnNumber: saved.returnNumber,
        invoiceNumber,
        total: Number(saved.total),
        appliedToInvoice: Number(saved.appliedToInvoice),
        refundAmount: Number(saved.refundAmount),
      },
    });

    try {
      const returnAccountId = await this.journalPosting.findAccountIdByCode(SALES_RETURN_CODE);
      const lines: PostingLine[] = [{ accountId: returnAccountId, debit: Number(saved.subtotal), description: 'Sales return' }];
      if (Number(saved.vatAmount) > 0) {
        const vatAccountId = await this.journalPosting.findAccountIdByCode(VAT_PAYABLE_CODE);
        lines.push({ accountId: vatAccountId, debit: Number(saved.vatAmount), description: 'VAT reversed on return' });
      }
      if (Number(saved.appliedToInvoice) > 0) {
        const arAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_RECEIVABLE_CODE);
        lines.push({ accountId: arAccountId, credit: Number(saved.appliedToInvoice), description: `Credit note — invoice ${invoiceNumber}` });
      }
      if (Number(saved.refundAmount) > 0 && saved.bankAccountId) {
        const bankJournalAccountId = await this.bankAccountService.ensureJournalAccountId(saved.bankAccountId);
        lines.push({ accountId: bankJournalAccountId, credit: Number(saved.refundAmount), description: 'Refund paid' });
      }
      // returned goods back on the Finished Goods asset, COGS relieved
      if (totalCost > 0) {
        const fgAccountId = await this.journalPosting.findAccountIdByCode(FG_INVENTORY_CODE);
        const cogsAccountId = await this.journalPosting.findAccountIdByCode(COGS_CODE);
        lines.push({ accountId: fgAccountId, debit: totalCost, description: 'Finished goods returned to stock' });
        lines.push({ accountId: cogsAccountId, credit: totalCost, description: 'Reversal of cost of goods sold' });
      }
      await this.journalPosting.postForSource(
        'sales_return',
        saved.id,
        saved.date,
        `Sales return ${saved.returnNumber}`,
        lines,
        decidedBy,
        saved.returnNumber,
      );
    } catch (err) {
      console.error(`Auto-posting failed for sales_return ${saved.id}:`, err);
    }

    await this.backorders.refresh(productIds);
    return saved;
  }

  // Credit Note PDF - same layouts as the invoice. Lines show the
  // invoice's unit price; the discount row is this return's share of the
  // invoice discount.
  async generateCreditNotePdf(id: string) {
    const item = await this.findOne(id);
    const invoice = await this.dataSource.manager.findOne(Invoice, { where: { id: item.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const customer = await this.customerService.findOne(item.customerId);
    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();
    const products = await this.dataSource.manager.find(FinishedGood, { where: { id: In(item.items.map((i) => i.finishedGoodId)) } });
    const nameOf = new Map(products.map((p) => [p.id, p.name]));
    const invoiceLines = await this.invoiceItemRepo.find({ where: { invoiceId: invoice.id } });
    const descOf = new Map(invoiceLines.filter((l) => l.finishedGoodId).map((l) => [l.finishedGoodId as string, l.description]));

    const pdfItems = item.items.map((i) => ({
      description: descOf.get(i.finishedGoodId) || nameOf.get(i.finishedGoodId) || 'Item',
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
      vatRate: invoice.vatExcluded ? 0 : Number(i.vatRate),
      lineTotal: this.round3(Number(i.quantity) * Number(i.unitPrice)),
    }));
    const gross = this.round3(pdfItems.reduce((sum, i) => sum + i.lineTotal, 0));
    const net = Number(item.subtotal);

    return generateInvoicePdf({
      invoiceNumber: item.returnNumber,
      version: 1,
      issueDate: item.date,
      quotationNumber: invoice.invoiceNumber,
      referenceLabel: 'Invoice No',
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName: customer.name,
      customerAddress: customer.address,
      customerPhone: customer.phone,
      customerVatin: customer.vatin,
      items: pdfItems,
      grossAmount: gross,
      discountAmount: this.round3(Math.max(0, gross - net)),
      taxableAmount: net,
      vatAmount: Number(item.vatAmount),
      netAmount: Number(item.total),
      vatExcluded: !!invoice.vatExcluded,
      logoBase64,
      template: settings.defaultInvoiceTemplate,
      documentType: 'credit_note',
    });
  }

  async reject(id: string, reason: string, decidedBy: ActorRef) {
    const item = await this.findOne(id);
    if (item.status !== SalesReturnStatus.PENDING) {
      throw new BadRequestException(`Only pending returns can be rejected (this one is ${item.status})`);
    }
    item.status = SalesReturnStatus.REJECTED;
    item.rejectionReason = reason;
    item.decidedByUserId = decidedBy.userId;
    item.decidedByEmail = decidedBy.email;
    item.decidedAt = new Date();
    const saved = await this.repo.save(item);
    await this.activityLog.log({
      action: 'sales_return.rejected',
      entityType: 'sales_return',
      entityId: saved.id,
      userId: decidedBy.userId,
      userEmail: decidedBy.email,
      details: { returnNumber: saved.returnNumber, reason },
    });
    return saved;
  }
}
