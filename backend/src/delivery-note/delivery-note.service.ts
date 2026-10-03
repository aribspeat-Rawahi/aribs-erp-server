import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryNote, DeliveryNoteStatus } from './delivery-note.entity';
import { DeliveryNoteItem } from './delivery-note-item.entity';
import { CreateDeliveryNoteDto, UpdateDeliveryNoteDto } from './dto/delivery-note.dto';
import { CustomerService } from '../customer/customer.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { generateInvoicePdf, InvoicePdfItem } from '../common/invoice-pdf.util';
import { DocumentLinkService } from '../document-link/document-link.service';

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
    items: { finishedGoodId?: string; description?: string; quantity: number; unitPrice?: number; vatRate?: number }[],
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
      dto.items,
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
          unitPrice: i.unitPrice || 0,
          vatRate: i.vatRate ?? 5,
          lineTotal: i.lineTotal,
        }),
      ),
    );

    return { ...saved, items };
  }

  async markDelivered(id: string) {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Delivery note not found');
    note.status = DeliveryNoteStatus.DELIVERED;
    return this.repo.save(note);
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
      const sourceItems = dto.items || existing.map((i) => ({
        finishedGoodId: i.finishedGoodId,
        description: i.description,
        quantity: Number(i.quantity),
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
    const phone = customer.phone.replace(/[^0-9]/g, '');
    const pdfUrl = this.documentLinks.createUrl('delivery_note', note.id);
    const message = `Hello ${customer.name}, your delivery note ${note.deliveryNoteNumber} is ready.`
      + (pdfUrl ? `\n\nView / download PDF:\n${pdfUrl}` : '');
    return { url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` };
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
