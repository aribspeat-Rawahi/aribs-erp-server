import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DeliveryNote, DeliveryNoteStatus } from './delivery-note.entity';
import { DeliveryNoteItem } from './delivery-note-item.entity';
import { CreateDeliveryNoteDto, UpdateDeliveryNoteDto } from './dto/delivery-note.dto';
import { CustomerService } from '../customer/customer.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { generateInvoicePdf, InvoicePdfItem } from '../common/invoice-pdf.util';
import { UnitService } from '../units/unit.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { buildWhatsappLinks, toWhatsappPhone } from '../common/whatsapp-phone.util';
import { Invoice } from '../invoice/invoice.entity';
import { InvoiceItem } from '../invoice/invoice-item.entity';
import { Customer } from '../customer/customer.entity';
import { BackorderService, ProductShortage } from '../stock-alerts/backorder.service';

// One row of Delivery Notes > Not Delivered Yet.
export interface PendingDeliveryRow {
  type: 'invoice' | 'delivery_note';
  id: string; // invoice id or delivery note id (by type)
  number: string; // INV-... or DN-...
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  issueDate: string;
  deliveryDate: string | null;
  deliveryMethod: string | null;
  items: { description: string; quantity: number; unit: string; finishedGoodId: string | null }[];
  waitingForStock: boolean;
  shortages: ProductShortage[];
  stockReadyAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class DeliveryNoteService {
  constructor(
    @InjectRepository(DeliveryNote)
    private repo: Repository<DeliveryNote>,
    @InjectRepository(DeliveryNoteItem)
    private itemRepo: Repository<DeliveryNoteItem>,
    private customerService: CustomerService,
    private settingsService: SettingsService,
    private activityLog: ActivityLogService,
    private documentLinks: DocumentLinkService,
    private units: UnitService,
    private backorders: BackorderService,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // VAT is summed per line using each line's OWN vatRate (defaulting to
  // 5% when not set), not a flat rate on the whole taxable total — same
  // pattern as Invoice/Quotation/PurchaseOrder.
  // Bug fix (2026-09-28): this used to apply a flat 5% to the whole
  // post-discount taxable amount regardless of each line's own vatRate,
  // over-charging VAT on zero-rated/discounted-rate line items.
  // The document-level discount is spread across lines pro-rata by each
  // line's share of the subtotal so it still reduces each line's own
  // taxable base before its rate is applied; the last line absorbs any
  // rounding remainder so the allocated discount always sums exactly to
  // `discount`.
  private calcTotals(
    items: { finishedGoodId?: string; description?: string; quantity: number; unit?: string; unitPrice?: number; vatRate?: number }[],
    discountAmount = 0,
  ) {
    let subtotal = 0;
    const computed = items.map((i) => {
      const lineTotal = this.round3(i.quantity * (i.unitPrice || 0));
      subtotal += lineTotal;
      return { ...i, lineTotal };
    });
    subtotal = this.round3(subtotal);
    const discount = this.round3(Math.min(Math.max(discountAmount, 0), subtotal));
    const taxable = this.round3(subtotal - discount);

    let vatAmount = 0;
    let allocatedDiscount = 0;
    computed.forEach((line, idx) => {
      const isLast = idx === computed.length - 1;
      const lineDiscount = isLast
        ? this.round3(discount - allocatedDiscount)
        : this.round3(subtotal > 0 ? (line.lineTotal / subtotal) * discount : 0);
      allocatedDiscount = this.round3(allocatedDiscount + lineDiscount);
      const lineTaxable = this.round3(line.lineTotal - lineDiscount);
      vatAmount += this.round3((lineTaxable * Number(line.vatRate ?? 5)) / 100);
    });
    vatAmount = this.round3(vatAmount);

    return { computed, subtotal, discountAmount: discount, vatAmount, total: this.round3(taxable + vatAmount) };
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    const items = await this.itemRepo.find({ where: { deliveryNoteId: id } });
    return { ...note, items };
  }

  async create(dto: CreateDeliveryNoteDto) {
    const { computed, subtotal, discountAmount, vatAmount, total } = this.calcTotals(
      await this.units.resolveProductLines(dto.items),
      dto.discountAmount ?? 0,
    );

    const note = this.repo.create({
      customerId: dto.customerId,
      issueDate: new Date().toISOString().slice(0, 10),
      deliveryDate: dto.deliveryDate,
      invoiceNumber: dto.invoiceNumber,
      quotationNumber: dto.quotationNumber,
      subtotal,
      discountAmount,
      vatAmount,
      total,
      paymentType: dto.paymentType,
      deliveryMethod: dto.deliveryMethod,
      status: DeliveryNoteStatus.DRAFT,
      deliveryNoteNumber: 'PENDING',
    });
    const saved = await this.repo.save(note);

    const year = new Date().getFullYear();
    saved.deliveryNoteNumber = `DN-${year}-${String(saved.sequenceNumber).padStart(4, '0')}`;
    await this.repo.save(saved);

    const items = await this.itemRepo.save(
      computed.map((i) =>
        this.itemRepo.create({
          deliveryNoteId: saved.id,
          finishedGoodId: i.finishedGoodId,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice || 0,
          vatRate: i.vatRate ?? 5,
          lineTotal: i.lineTotal,
        }),
      ),
    );

    return { ...saved, items };
  }

  // A delivered delivery note also marks its invoice delivered.
  async markDelivered(id: string) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    note.status = DeliveryNoteStatus.DELIVERED;
    const saved = await this.repo.save(note);
    if (note.invoiceNumber) {
      const invoice = await this.dataSource.getRepository(Invoice).findOne({ where: { invoiceNumber: note.invoiceNumber } });
      if (invoice) await this.markInvoiceDelivered(invoice.id, 'delivery_note');
    }
    return saved;
  }

  // "Mark delivered" on an invoice row (no delivery note), or via its
  // delivery note. Lives here (not in InvoiceService) because
  // InvoiceService already depends on this service.
  async markInvoiceDelivered(invoiceId: string, via: 'manual' | 'delivery_note' = 'manual') {
    const invoiceRepo = this.dataSource.getRepository(Invoice);
    const invoice = await invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.deliveryStatus === 'delivered') return invoice;
    invoice.deliveryStatus = 'delivered';
    invoice.deliveredVia = via;
    invoice.deliveredAt = new Date();
    await invoiceRepo.save(invoice);
    // a delivered invoice no longer waits for stock, so the shortage moves
    // to the next pending invoice of those products
    const items = await this.dataSource.getRepository(InvoiceItem).find({ where: { invoiceId } });
    await this.backorders.refresh([...new Set(items.map((i) => i.finishedGoodId).filter((x): x is string => !!x))]);
    return invoice;
  }

  // Delivery Notes > Not Delivered Yet:
  //  - invoices not delivered yet (In Store ones are delivered at once)
  //    that have no delivery note;
  //  - delivery notes not delivered yet (showing their invoice number).
  // An invoice with a delivery note appears only as that delivery note.
  async findPendingDeliveries(): Promise<PendingDeliveryRow[]> {
    const invoiceRepo = this.dataSource.getRepository(Invoice);
    const pendingInvoices = await invoiceRepo.find({ where: { deliveryStatus: 'pending' }, order: { createdAt: 'DESC' } });
    const pendingNotes = await this.repo.find({ where: { status: DeliveryNoteStatus.DRAFT }, order: { createdAt: 'DESC' } });

    // invoice numbers that already have a delivery note (any status)
    const invoiceNumbers = pendingInvoices.map((i) => i.invoiceNumber);
    const notesForInvoices = invoiceNumbers.length
      ? await this.repo.find({ where: { invoiceNumber: In(invoiceNumbers) }, select: { id: true, invoiceNumber: true } })
      : [];
    const hasNote = new Set(notesForInvoices.map((n) => n.invoiceNumber));
    const invoicesWithoutNote = pendingInvoices.filter((i) => !hasNote.has(i.invoiceNumber));

    // invoices linked to the pending notes (for the stock status)
    const linkedNumbers = [...new Set(pendingNotes.map((n) => n.invoiceNumber).filter((x): x is string => !!x))];
    const linkedInvoices = linkedNumbers.length ? await invoiceRepo.find({ where: { invoiceNumber: In(linkedNumbers) } }) : [];
    const invoiceByNumber = new Map(linkedInvoices.map((i) => [i.invoiceNumber, i]));

    const invoiceItems = invoicesWithoutNote.length
      ? await this.dataSource.getRepository(InvoiceItem).find({ where: { invoiceId: In(invoicesWithoutNote.map((i) => i.id)) } })
      : [];
    const noteItems = pendingNotes.length ? await this.itemRepo.find({ where: { deliveryNoteId: In(pendingNotes.map((n) => n.id)) } }) : [];

    const customerIds = [...new Set([...invoicesWithoutNote.map((i) => i.customerId), ...pendingNotes.map((n) => n.customerId)])];
    const customers = customerIds.length ? await this.dataSource.getRepository(Customer).find({ where: { id: In(customerIds) } }) : [];
    const customerName = new Map(customers.map((c) => [c.id, c.name]));

    const shortages = await this.backorders.computeShortages();
    const line = (i: { description: string; quantity: number | string; unit: string; finishedGoodId?: string | null }) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unit: i.unit,
      finishedGoodId: i.finishedGoodId || null,
    });

    const rows: PendingDeliveryRow[] = [];
    for (const inv of invoicesWithoutNote) {
      const short = shortages.get(inv.id) || [];
      rows.push({
        type: 'invoice',
        id: inv.id,
        number: inv.invoiceNumber,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerId: inv.customerId,
        customerName: customerName.get(inv.customerId) || '',
        issueDate: inv.issueDate,
        deliveryDate: inv.deliveryDate || null,
        deliveryMethod: inv.deliveryMethod || null,
        items: invoiceItems.filter((it) => it.invoiceId === inv.id).map(line),
        waitingForStock: short.length > 0,
        shortages: short,
        stockReadyAt: inv.stockReadyAt || null,
        createdAt: inv.createdAt,
      });
    }
    for (const note of pendingNotes) {
      const inv = note.invoiceNumber ? invoiceByNumber.get(note.invoiceNumber) : undefined;
      const short = inv && inv.deliveryStatus === 'pending' ? shortages.get(inv.id) || [] : [];
      rows.push({
        type: 'delivery_note',
        id: note.id,
        number: note.deliveryNoteNumber,
        invoiceId: inv?.id || null,
        invoiceNumber: note.invoiceNumber || null,
        customerId: note.customerId,
        customerName: customerName.get(note.customerId) || '',
        issueDate: note.issueDate,
        deliveryDate: note.deliveryDate || inv?.deliveryDate || null,
        deliveryMethod: note.deliveryMethod || null,
        items: noteItems.filter((it) => it.deliveryNoteId === note.id).map(line),
        waitingForStock: short.length > 0,
        shortages: short,
        stockReadyAt: inv?.stockReadyAt || null,
        createdAt: note.createdAt,
      });
    }
    // nearest delivery date first; rows without a date last
    rows.sort((a, b) => {
      if (a.deliveryDate && b.deliveryDate && a.deliveryDate !== b.deliveryDate) return a.deliveryDate < b.deliveryDate ? -1 : 1;
      if (!!a.deliveryDate !== !!b.deliveryDate) return a.deliveryDate ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return rows;
  }

  // Simpler than Invoice/Quotation edits — no same-day/approval rules,
  // since a delivery note isn't a tax document or a price commitment.
  // Any authenticated user can correct it (e.g. quantity typo) any time
  // before it's marked delivered.
  async update(id: string, dto: UpdateDeliveryNoteDto) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    if (note.status === DeliveryNoteStatus.DELIVERED) {
      throw new BadRequestException('This delivery note is already marked delivered and can no longer be edited');
    }

    if (dto.customerId !== undefined) {
      await this.customerService.findOne(dto.customerId); // validates the id
      note.customerId = dto.customerId;
    }
    if (dto.deliveryDate !== undefined) note.deliveryDate = dto.deliveryDate;
    if (dto.paymentType !== undefined) note.paymentType = dto.paymentType;
    if (dto.deliveryMethod !== undefined) note.deliveryMethod = dto.deliveryMethod;

    const discountChanged = dto.discountAmount !== undefined && Number(dto.discountAmount) !== Number(note.discountAmount);

    if (dto.items || discountChanged) {
      const existing = await this.itemRepo.find({ where: { deliveryNoteId: id } });
      // DB decimal columns come back as strings — cast explicitly when
      // recomputing from existing rows (discount-only change, no dto.items).
      const sourceItems = dto.items ? await this.units.resolveProductLines(dto.items) : existing.map((i) => ({
        finishedGoodId: i.finishedGoodId,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPrice: Number(i.unitPrice),
        vatRate: Number(i.vatRate),
      }));
      if (dto.items) {
        await this.itemRepo.remove(existing);
      }

      const { computed, subtotal, discountAmount, vatAmount, total } = this.calcTotals(
        sourceItems,
        dto.discountAmount ?? Number(note.discountAmount),
      );

      if (dto.items) {
        await this.itemRepo.save(
          computed.map((i) =>
            this.itemRepo.create({
              deliveryNoteId: id,
              finishedGoodId: i['finishedGoodId'],
              description: i['description'],
              quantity: i.quantity,
              unit: i['unit'],
              unitPrice: i.unitPrice || 0,
              vatRate: i['vatRate'] ?? 5,
              lineTotal: i.lineTotal,
            }),
          ),
        );
      }
      note.subtotal = subtotal;
      note.discountAmount = discountAmount;
      note.vatAmount = vatAmount;
      note.total = total;
    }

    const saved = await this.repo.save(note);
    const items = await this.itemRepo.find({ where: { deliveryNoteId: id } });
    return { ...saved, items };
  }

  async generatePdfBuffer(id: string) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    const items = await this.itemRepo.find({ where: { deliveryNoteId: id } });
    const customer = await this.customerService.findOne(note.customerId);
    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();

    const pdfItems: InvoicePdfItem[] = items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
      vatRate: Number(i.vatRate),
      lineTotal: Number(i.lineTotal),
    }));

    return generateInvoicePdf({
      invoiceNumber: note.deliveryNoteNumber,
      version: 1,
      issueDate: note.issueDate,
      dueDate: undefined,
      deliveryDate: note.deliveryDate,
      quotationNumber: note.quotationNumber,
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName: customer.name,
      customerAddress: customer.address,
      customerPhone: customer.phone,
      customerVatin: customer.vatin,
      items: pdfItems,
      grossAmount: Number(note.subtotal),
      discountAmount: Number(note.discountAmount || 0),
      taxableAmount: this.round3(Number(note.subtotal) - Number(note.discountAmount || 0)),
      vatAmount: Number(note.vatAmount),
      netAmount: Number(note.total),
      vatExcluded: false,
      paymentType: note.paymentType,
      deliveryMethod: note.deliveryMethod,
      logoBase64,
      template: settings.defaultInvoiceTemplate,
      documentType: 'delivery_note',
    });
  }

  async getWhatsappLink(id: string) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    const customer = await this.customerService.findOne(note.customerId);
    if (!customer.phone) {
      throw new BadRequestException('This customer has no phone number on file');
    }
    const phone = toWhatsappPhone(customer.phone);
    const pdfUrl = this.documentLinks.createUrl('delivery_note', note.id);
    const message = `Hello ${customer.name}, your delivery note ${note.deliveryNoteNumber} is ready.`
      + (pdfUrl ? `\n\nView / download PDF:\n${pdfUrl}` : '');
    return buildWhatsappLinks(phone, message);
  }

  // Admin-only (enforced at the controller).
  async remove(id: string, deletedBy?: { userId?: string; email?: string }) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    const items = await this.itemRepo.find({ where: { deliveryNoteId: id } });
    if (items.length > 0) await this.itemRepo.remove(items);
    await this.repo.remove(note);
    await this.activityLog.log({
      action: 'delivery_note.deleted',
      entityType: 'delivery_note',
      entityId: id,
      userId: deletedBy?.userId,
      userEmail: deletedBy?.email,
      details: { deliveryNoteNumber: note.deliveryNoteNumber },
    });
    return { deleted: true };
  }
}
