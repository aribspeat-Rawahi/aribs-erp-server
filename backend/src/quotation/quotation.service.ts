import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Quotation, QuotationStatus } from './quotation.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationEditRequest, QuotationEditStatus } from './quotation-edit-request.entity';
import { CreateQuotationDto, UpdateQuotationDto } from './dto/quotation.dto';
import { InvoiceService } from '../invoice/invoice.service';
import { SettingsService } from '../settings/settings.service';
import { CustomerService } from '../customer/customer.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { generateInvoicePdf, InvoicePdfItem } from '../common/invoice-pdf.util';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalRequestType, ApprovalRequestStatus } from '../approval/approval-request.entity';
import { DocumentLinkService } from '../document-link/document-link.service';
import { buildWhatsappLinks, toWhatsappPhone } from '../common/whatsapp-phone.util';
import { EmailService } from '../common/email.service';
import { UnitService } from '../units/unit.service';

@Injectable()
export class QuotationService {
  constructor(
    @InjectRepository(Quotation)
    private quotationRepo: Repository<Quotation>,
    @InjectRepository(QuotationItem)
    private itemRepo: Repository<QuotationItem>,
    @InjectRepository(QuotationEditRequest)
    private editRepo: Repository<QuotationEditRequest>,
    private invoiceService: InvoiceService,
    private settingsService: SettingsService,
    private customerService: CustomerService,
    private activityLog: ActivityLogService,
    // One-directional, same as InvoiceModule — see ApprovalModule's own
    // comment for why this never becomes circular.
    private approvalService: ApprovalService,
    private config: ConfigService,
    private documentLinks: DocumentLinkService,
    private units: UnitService,
    private emailService: EmailService,
  ) {}

  findAll() {
    return this.quotationRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    const items = await this.itemRepo.find({ where: { quotationId: id } });
    return { ...quotation, items };
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private discountApprovalThresholdPercent(): number {
    const raw = this.config.get('DISCOUNT_APPROVAL_THRESHOLD_PERCENT');
    const n = raw !== undefined ? Number(raw) : NaN;
    return !isNaN(n) && n >= 0 ? n : 10; // same default/env var as Invoice's gate
  }

  // CRM Step 7 gates that apply to quotations: a large discount, and
  // excluding VAT for a customer who is normally VAT-applicable (same rule
  // as invoices). No credit-limit gate - a quotation doesn't create debt.
  private approvalGates(
    customer: { name: string; vatApplicable?: boolean },
    subtotal: number,
    discountAmount: number,
    vatExcluded: boolean,
  ): { type: ApprovalRequestType; reason: string }[] {
    const gates: { type: ApprovalRequestType; reason: string }[] = [];
    if (subtotal > 0) {
      const thresholdPercent = this.discountApprovalThresholdPercent();
      const discountPercent = (discountAmount / subtotal) * 100;
      if (discountPercent > thresholdPercent + 0.001) {
        gates.push({
          type: ApprovalRequestType.LARGE_DISCOUNT,
          reason: `Discount of ${discountPercent.toFixed(1)}% (${discountAmount.toFixed(3)} OMR) exceeds the ${thresholdPercent}% approval threshold.`,
        });
      }
    }
    if (vatExcluded && customer.vatApplicable) {
      gates.push({
        type: ApprovalRequestType.VAT_EXCLUDE,
        reason: `VAT is being excluded for ${customer.name}, who is normally VAT-applicable.`,
      });
    }
    return gates;
  }

  async create(dto: CreateQuotationDto, opts?: { skipApprovalGates?: boolean; requestedBy?: { userId?: string; email?: string } }) {
    const customer = await this.customerService.findOne(dto.customerId);
    const vatExcluded = dto.vatExcluded ?? !customer.vatApplicable;
    const lines = await this.units.resolveProductLines(dto.items);
    const { computed, subtotal, discountAmount, vatAmount, total } = this.computeTotals(
      lines,
      dto.discountAmount ?? 0,
      vatExcluded,
    );

    if (!opts?.skipApprovalGates) {
      const gates = this.approvalGates(customer, subtotal, discountAmount, vatExcluded);
      if (gates.length > 0) {
        const reason = gates.map((g) => g.reason).join(' ');
        if (!dto.requestApproval) {
          throw new BadRequestException({ approvalRequired: true, gates, message: `This quotation needs approval: ${reason}` });
        }
        const approvalRequest = await this.approvalService.create({
          type: gates[0].type,
          entityType: 'quotation',
          customerId: dto.customerId,
          payload: dto,
          reason,
          requestedBy: opts?.requestedBy,
        });
        return { pendingApproval: true, approvalRequestId: approvalRequest.id, message: 'Sent for approval — the quotation will be created once approved.' };
      }
    }

    const quotation = this.quotationRepo.create({
      customerId: dto.customerId,
      issueDate: new Date().toISOString().slice(0, 10),
      validUntil: dto.validUntil,
      subtotal,
      discountAmount,
      vatAmount,
      total,
      deliveryMethod: dto.deliveryMethod,
      paymentType: dto.paymentType,
      deliveryDate: dto.deliveryDate,
      template: dto.template || (await this.settingsService.get()).defaultInvoiceTemplate,
      vatExcluded,
      status: QuotationStatus.DRAFT,
      quotationNumber: 'PENDING',
    });
    const saved = await this.quotationRepo.save(quotation);

    const year = new Date().getFullYear();
    saved.quotationNumber = `QTN-${year}-${String(saved.sequenceNumber).padStart(4, '0')}`;
    await this.quotationRepo.save(saved);

    const items = await this.itemRepo.save(
      computed.map((i) =>
        this.itemRepo.create({
          quotationId: saved.id,
          finishedGoodId: i.finishedGoodId,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate ?? 5,
          lineTotal: i.lineTotal,
        }),
      ),
    );

    if (vatExcluded && customer.vatApplicable) {
      await this.emailService.sendVatExcludedNotice(saved.quotationNumber, customer.name, total);
    }

    return { ...saved, items };
  }

  async approve(id: string) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    quotation.status = QuotationStatus.APPROVED;
    return this.quotationRepo.save(quotation);
  }

  // VAT is summed per line using each line's OWN vatRate (defaulting to
  // 5% when not set), not a flat rate on the whole taxable total — same
  // pattern as Invoice/PurchaseOrder.
  // Bug fix (2026-09-28): this used to apply a flat 5% to the whole
  // post-discount taxable amount regardless of each line's own vatRate,
  // over-charging VAT on zero-rated/discounted-rate line items.
  // The document-level discount is spread across lines pro-rata by each
  // line's share of the subtotal so it still reduces each line's own
  // taxable base before its rate is applied; the last line absorbs any
  // rounding remainder so the allocated discount always sums exactly to
  // `discount`.
  private computeTotals(
    items: { finishedGoodId?: string; description?: string; quantity: number; unit?: string; unitPrice: number; vatRate?: number }[],
    discountAmount = 0,
    vatExcluded = false,
  ) {
    let subtotal = 0;
    const computed = items.map((i) => {
      const lineTotal = this.round3(i.quantity * i.unitPrice);
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
      vatAmount += vatExcluded ? 0 : this.round3((lineTaxable * Number(line.vatRate ?? 5)) / 100);
    });
    vatAmount = this.round3(vatAmount);

    return { computed, subtotal, discountAmount: discount, vatAmount, total: this.round3(taxable + vatAmount) };
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  private async applyItemsToQuotation(
    quotation: Quotation,
    items: { finishedGoodId?: string; description: string; quantity: number; unit?: string; unitPrice: number; vatRate?: number }[],
    discountAmount?: number,
  ) {
    const lines = await this.units.resolveProductLines(items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })));
    const existing = await this.itemRepo.find({ where: { quotationId: quotation.id } });
    await this.itemRepo.remove(existing);
    const { computed, subtotal, discountAmount: discount, vatAmount, total } = this.computeTotals(
      lines,
      discountAmount ?? Number(quotation.discountAmount),
      quotation.vatExcluded,
    );
    const saved = await this.itemRepo.save(
      computed.map((i) =>
        this.itemRepo.create({
          quotationId: quotation.id,
          finishedGoodId: i['finishedGoodId'],
          description: i['description'],
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate ?? 5,
          lineTotal: i.lineTotal,
        }),
      ),
    );
    quotation.subtotal = subtotal;
    quotation.discountAmount = discount;
    quotation.vatAmount = vatAmount;
    quotation.total = total;
    await this.quotationRepo.save(quotation);
    return saved;
  }

  // Editing a quotation:
  // - Same calendar day as issueDate -> applies immediately, no approval
  //   needed (this is "fixing a typo minutes after creating it").
  // - Any later day -> queued as a QuotationEditRequest. It only takes
  //   effect once someone with the right role (CEO, MD, Accountant, or
  //   Admin) approves it via approveEdit().
  async requestEdit(
    id: string,
    dto: UpdateQuotationDto,
    requestedBy?: { userId?: string; email?: string },
    opts?: { skipApprovalGates?: boolean },
  ) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.CONVERTED) {
      throw new BadRequestException('This quotation was already converted to an invoice and can no longer be edited');
    }

    // Turning VAT OFF for a normally VAT-applicable customer needs the
    // same approval as on an invoice; once allowed (or when turning VAT
    // back ON) it applies straight away and the totals are recalculated.
    const vatExcludedChanged = dto.vatExcluded !== undefined && dto.vatExcluded !== quotation.vatExcluded;
    if (vatExcludedChanged && dto.vatExcluded && !opts?.skipApprovalGates) {
      const customer = await this.customerService.findOne(dto.customerId || quotation.customerId);
      if (customer.vatApplicable) {
        const reason = `VAT is being excluded for ${customer.name}, who is normally VAT-applicable.`;
        if (!dto.requestApproval) {
          throw new BadRequestException({
            approvalRequired: true,
            gates: [{ type: ApprovalRequestType.VAT_EXCLUDE, reason }],
            message: `This change needs approval: ${reason}`,
          });
        }
        const approvalRequest = await this.approvalService.create({
          type: ApprovalRequestType.VAT_EXCLUDE,
          entityType: 'quotation',
          targetId: id,
          customerId: quotation.customerId,
          payload: dto,
          reason,
          requestedBy,
        });
        return { pendingApproval: true, approvalRequestId: approvalRequest.id, message: 'Sent for approval — changes will apply once approved.' };
      }
    }
    if (vatExcludedChanged) {
      quotation.vatExcluded = !!dto.vatExcluded;
      await this.quotationRepo.save(quotation);
      if (!dto.items && dto.discountAmount === undefined) {
        // recalculate VAT on the current lines
        await this.applyItemsToQuotation(quotation, await this.itemRepo.find({ where: { quotationId: id } }));
      }
    }
    if (dto.paymentType !== undefined) quotation.paymentType = dto.paymentType;
    if (dto.deliveryDate !== undefined) quotation.deliveryDate = dto.deliveryDate || (null as unknown as string);
    if (dto.template !== undefined) quotation.template = dto.template;
    if (dto.paymentType !== undefined || dto.deliveryDate !== undefined || dto.template !== undefined) {
      await this.quotationRepo.save(quotation);
    }

    // Delivery method and customer are metadata (not a price commitment)
    // — like validUntil, they can always be updated immediately
    // regardless of date. customerService.findOne validates the id.
    if (dto.customerId !== undefined) {
      await this.customerService.findOne(dto.customerId);
      quotation.customerId = dto.customerId;
      await this.quotationRepo.save(quotation);
    }
    if (dto.deliveryMethod !== undefined) {
      quotation.deliveryMethod = dto.deliveryMethod;
      await this.quotationRepo.save(quotation);
    }

    if (!dto.items && dto.discountAmount === undefined) {
      // Nothing price/item-impacting in this request (customerId and
      // deliveryMethod were already applied above, if present) — apply
      // validUntil too if given, and return immediately regardless of date.
      if (dto.validUntil !== undefined) {
        quotation.validUntil = dto.validUntil;
        await this.quotationRepo.save(quotation);
      }
      return { applied: true, quotation };
    }

    const isSameDay = quotation.issueDate === this.todayStr();

    if (isSameDay) {
      if (dto.items || dto.discountAmount !== undefined) {
        await this.applyItemsToQuotation(
          quotation,
          dto.items || (await this.itemRepo.find({ where: { quotationId: id } })),
          dto.discountAmount,
        );
      }
      if (dto.validUntil !== undefined) {
        quotation.validUntil = dto.validUntil;
        await this.quotationRepo.save(quotation);
      }
      const items = await this.itemRepo.find({ where: { quotationId: id } });
      return { applied: true, quotation: { ...quotation, items } };
    }

    // Different day and there's a price-impacting change (items or
    // discount) — queue for approval instead of applying directly.
    // (deliveryMethod/validUntil above were already applied immediately.)
    const editRequest = this.editRepo.create({
      quotationId: id,
      proposedItems: JSON.stringify(dto.items || []),
      proposedValidUntil: dto.validUntil,
      proposedDiscountAmount: dto.discountAmount,
      status: QuotationEditStatus.PENDING,
      requestedByUserId: requestedBy?.userId,
      requestedByEmail: requestedBy?.email,
    });
    const saved = await this.editRepo.save(editRequest);
    return { applied: false, editRequest: saved };
  }

  // Replays a stored large-discount ApprovalRequest once approved —
  // quotations only ever hit this gate on create() (see above), so
  // targetId is never set for a quotation-type request.
  async applyApprovedQuotationRequest(approvalRequestId: string, approvedBy?: { userId?: string; email?: string }) {
    const request = await this.approvalService.claimPending(approvalRequestId, 'quotation');
    const payload = JSON.parse(request.payload);
    // targetId set = an edit to an existing quotation (VAT exclude), else a new one.
    const result = request.targetId
      ? await this.requestEdit(request.targetId, payload, undefined, { skipApprovalGates: true })
      : await this.create(payload, { skipApprovalGates: true });
    await this.approvalService.markDecided(approvalRequestId, ApprovalRequestStatus.APPROVED, approvedBy);
    return result;
  }

  async rejectQuotationApprovalRequest(approvalRequestId: string, decidedBy?: { userId?: string; email?: string }) {
    return this.approvalService.reject(approvalRequestId, 'quotation', decidedBy);
  }

  listPendingEdits() {
    return this.editRepo.find({ where: { status: QuotationEditStatus.PENDING }, order: { createdAt: 'ASC' } });
  }

  async approveEdit(editRequestId: string, approvedBy?: { userId?: string; email?: string }) {
    const editRequest = await this.editRepo.findOne({ where: { id: editRequestId } });
    if (!editRequest) throw new NotFoundException('Edit request not found');
    if (editRequest.status !== QuotationEditStatus.PENDING) {
      throw new BadRequestException(`This edit request is already ${editRequest.status}`);
    }
    const quotation = await this.quotationRepo.findOne({ where: { id: editRequest.quotationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const items = JSON.parse(editRequest.proposedItems);
    const proposedDiscount = editRequest.proposedDiscountAmount != null ? Number(editRequest.proposedDiscountAmount) : undefined;
    if (items.length > 0 || proposedDiscount !== undefined) {
      const itemsToApply = items.length > 0 ? items : await this.itemRepo.find({ where: { quotationId: quotation.id } });
      await this.applyItemsToQuotation(quotation, itemsToApply, proposedDiscount);
    }
    if (editRequest.proposedValidUntil) {
      quotation.validUntil = editRequest.proposedValidUntil;
      await this.quotationRepo.save(quotation);
    }

    editRequest.status = QuotationEditStatus.APPROVED;
    editRequest.approvedByUserId = approvedBy?.userId;
    editRequest.approvedByEmail = approvedBy?.email;
    editRequest.decidedAt = new Date();
    await this.editRepo.save(editRequest);

    return { editRequest, quotation };
  }

  async rejectEdit(editRequestId: string, approvedBy?: { userId?: string; email?: string }) {
    const editRequest = await this.editRepo.findOne({ where: { id: editRequestId } });
    if (!editRequest) throw new NotFoundException('Edit request not found');
    if (editRequest.status !== QuotationEditStatus.PENDING) {
      throw new BadRequestException(`This edit request is already ${editRequest.status}`);
    }
    editRequest.status = QuotationEditStatus.REJECTED;
    editRequest.approvedByUserId = approvedBy?.userId;
    editRequest.approvedByEmail = approvedBy?.email;
    editRequest.decidedAt = new Date();
    return this.editRepo.save(editRequest);
  }

  // Generated fresh each time (not saved/versioned like Invoice PDFs —
  // a quotation is a proposal, so there's no audit requirement to keep
  // every past PDF on disk).
  async generatePdfBuffer(id: string) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    const items = await this.itemRepo.find({ where: { quotationId: id } });
    const customer = await this.customerService.findOne(quotation.customerId);
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
      invoiceNumber: quotation.quotationNumber,
      version: 1,
      issueDate: quotation.issueDate,
      dueDate: undefined,
      deliveryDate: quotation.deliveryDate,
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName: customer.name,
      customerAddress: customer.address,
      customerPhone: customer.phone,
      customerVatin: customer.vatin,
      items: pdfItems,
      grossAmount: Number(quotation.subtotal),
      discountAmount: Number(quotation.discountAmount || 0),
      taxableAmount: this.round3(Number(quotation.subtotal) - Number(quotation.discountAmount || 0)),
      vatAmount: Number(quotation.vatAmount),
      netAmount: Number(quotation.total),
      vatExcluded: quotation.vatExcluded,
      paymentType: quotation.paymentType,
      deliveryMethod: quotation.deliveryMethod,
      logoBase64,
      template: quotation.template || settings.defaultInvoiceTemplate,
      documentType: 'quotation',
    });
  }

  // wa.me link — same free, no-paid-API approach as Invoices.
  async getWhatsappLink(id: string) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    const customer = await this.customerService.findOne(quotation.customerId);
    if (!customer.phone) {
      throw new BadRequestException('This customer has no phone number on file');
    }
    const phone = toWhatsappPhone(customer.phone);
    const pdfUrl = this.documentLinks.createUrl('quotation', quotation.id);
    const message = `Hello ${customer.name}, your quotation ${quotation.quotationNumber} totalling ${quotation.total} OMR is ready.`
      + (pdfUrl ? `\n\nView / download PDF:\n${pdfUrl}` : '');
    return buildWhatsappLinks(phone, message);
  }

  // One-click convert: builds an Invoice from this quotation's items and
  // prices exactly as they are (including any manual price adjustments).
  async convertToInvoice(id: string) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.CONVERTED) {
      throw new BadRequestException('This quotation was already converted to an invoice');
    }
    const items = await this.itemRepo.find({ where: { quotationId: id } });

    // skipApprovalGates: the discount/customer here already went through
    // whatever scrutiny the quotation itself got (including its own
    // large-discount gate on create) — converting it to an invoice
    // shouldn't re-block on the same numbers a second time.
    const invoice = await this.invoiceService.create(
      {
        customerId: quotation.customerId,
        quotationNumber: quotation.quotationNumber,
        discountAmount: Number(quotation.discountAmount || 0),
        deliveryMethod: quotation.deliveryMethod,
        paymentType: quotation.paymentType,
        deliveryDate: quotation.deliveryDate || undefined,
        template: quotation.template,
        vatExcluded: quotation.vatExcluded,
        items: items.map((i) => ({
          finishedGoodId: i.finishedGoodId,
          description: i.description,
          quantity: Number(i.quantity),
          unit: i.unit,
          unitPrice: Number(i.unitPrice),
          vatRate: Number(i.vatRate),
        })),
      },
      { skipApprovalGates: true },
    );
    if ('pendingApproval' in invoice) {
      // Can't happen with skipApprovalGates:true — guards TypeScript's
      // narrowing (create()'s return type is a union) and fails loudly
      // instead of silently writing a bad invoiceId if it ever did.
      throw new BadRequestException('Unexpected: invoice conversion should not require approval.');
    }

    quotation.status = QuotationStatus.CONVERTED;
    quotation.invoiceId = invoice.id;
    await this.quotationRepo.save(quotation);

    return invoice;
  }

  // Admin-only (enforced at the controller).
  async remove(id: string, deletedBy?: { userId?: string; email?: string }) {
    const quotation = await this.quotationRepo.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    const items = await this.itemRepo.find({ where: { quotationId: id } });
    if (items.length > 0) await this.itemRepo.remove(items);
    await this.quotationRepo.remove(quotation);
    await this.activityLog.log({
      action: 'quotation.deleted',
      entityType: 'quotation',
      entityId: id,
      userId: deletedBy?.userId,
      userEmail: deletedBy?.email,
      details: { quotationNumber: quotation.quotationNumber, total: Number(quotation.total) },
    });
    return { deleted: true };
  }
}
