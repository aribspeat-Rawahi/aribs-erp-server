import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { Rfq, RfqItem, RfqQuote, RfqStatus } from './rfq.entity';
import { PurchaseRequisition, PurchaseRequisitionItem, RequisitionStatus } from './purchase-requisition.entity';
import { AwardRfqDto, CreateRfqDto, RfqQuoteDto } from './dto/procurement.dto';
import { ApprovalActor } from '../document-approval/document-approval.service';
import { PurchaseOrderService } from '../supplier/purchase-order.service';
import { Supplier, SupplierVatStatus } from '../supplier/supplier.entity';
import { RawMaterial } from '../inventory/raw-material.entity';
import { UnitService } from '../units/unit.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { omanToday } from '../common/oman-date';
import { orderedByRequisitionItem } from './requisition-util';
import { SettingsService } from '../settings/settings.service';
import { generateRfqPdf } from '../common/rfq-pdf.util';
import { omanDate } from '../common/oman-date';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isDate = (d?: string | null) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);

export interface QuoteLine {
  rfqItemId: string;
  unitPrice: number;
}

// Request for Quotation: several suppliers price the same items; the
// comparison shows the cheapest complete quote; awarding a quote makes the
// purchase order at the quoted prices (the order then needs its own
// approval). Choosing a quote that is not the cheapest needs a reason,
// kept with the RFQ for audit.
@Injectable()
export class RfqService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private purchaseOrders: PurchaseOrderService,
    private units: UnitService,
    private activityLog: ActivityLogService,
    private settingsService: SettingsService,
  ) {}

  // RFQ to send to a supplier (bilingual, Omani layout). With a supplierId
  // the "To" box is filled in; without, it is left blank for any supplier.
  async pdf(id: string, supplierId?: string) {
    const rfq = await this.findOne(id);
    const supplier = supplierId ? await this.dataSource.manager.findOne(Supplier, { where: { id: supplierId } }) : null;
    if (supplierId && !supplier) throw new NotFoundException('Supplier not found');
    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();
    const buffer = await generateRfqPdf({
      rfqNumber: rfq.rfqNumber,
      date: omanDate(rfq.createdAt),
      quotesDueBy: rfq.quotesDueBy,
      reference: rfq.prNumber,
      title: rfq.title,
      notes: rfq.notes,
      companyName: settings.companyName,
      companyNameArabic: settings.companyNameArabic,
      companyVatin: settings.companyVatin,
      companyCrNumber: settings.companyCrNumber,
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
      logoBase64,
      supplier: supplier
        ? { name: supplier.name, contactPerson: supplier.contactPerson, address: supplier.address, phone: supplier.phone, email: supplier.email, vatin: supplier.vatin, paymentTermsDays: supplier.paymentTermsDays }
        : null,
      items: rfq.items.map((i) => ({ description: i.materialName, quantity: i.quantity, unit: i.unit })),
      preparedBy: rfq.createdByEmail,
    });
    return { buffer, fileName: `${rfq.rfqNumber}${supplier ? `-${supplier.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}` : ''}.pdf` };
  }

  async create(dto: CreateRfqDto, actor: ApprovalActor) {
    if (!isDate(dto.quotesDueBy)) throw new BadRequestException('Quotes-due date must be YYYY-MM-DD.');
    let title = dto.title?.trim() || '';
    let items: { rawMaterialId: string; quantity: number; requisitionItemId?: string | null }[] = dto.items || [];
    if (dto.requisitionId) {
      const pr = await this.dataSource.manager.findOne(PurchaseRequisition, { where: { id: dto.requisitionId } });
      if (!pr) throw new NotFoundException('Purchase requisition not found');
      if (pr.status !== RequisitionStatus.APPROVED) throw new BadRequestException(`${pr.prNumber} is ${pr.status.replace('_', ' ')} - only an approved requisition can go out for quotes.`);
      const prItems = await this.dataSource.manager.find(PurchaseRequisitionItem, { where: { requisitionId: pr.id } });
      const ordered = await orderedByRequisitionItem(this.dataSource.manager, prItems.map((i) => i.id));
      if (!items.length) {
        items = prItems
          .map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: r3(Number(i.quantity) - (ordered.get(i.id) || 0)), requisitionItemId: i.id }))
          .filter((i) => i.quantity > 0.0005);
      }
      for (const i of items) {
        const p = prItems.find((x) => x.id === i.requisitionItemId);
        if (i.requisitionItemId && (!p || p.rawMaterialId !== i.rawMaterialId)) throw new BadRequestException(`A line is not part of ${pr.prNumber}.`);
      }
      title = title || `Quotes for ${pr.prNumber} - ${pr.purpose}`.slice(0, 200);
    }
    if (!items.length) throw new BadRequestException(dto.requisitionId ? 'Everything on this requisition is already ordered.' : 'Add at least one item.');
    if (!title) throw new BadRequestException('Give the RFQ a title.');
    const lines = await this.units.resolveRawMaterialLines(items);
    const id = await this.dataSource.transaction(async (manager) => {
      const rfq = await manager.save(
        manager.create(Rfq, {
          rfqNumber: `TMP-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          requisitionId: dto.requisitionId || null,
          title,
          quotesDueBy: dto.quotesDueBy || null,
          notes: dto.notes?.trim() || null,
          status: RfqStatus.OPEN,
          createdByUserId: actor.userId || null,
          createdByEmail: actor.email || null,
        }),
      );
      rfq.rfqNumber = `RFQ-${omanToday().slice(0, 4)}-${String(rfq.sequenceNumber).padStart(4, '0')}`;
      await manager.save(rfq);
      await manager.save(
        lines.map((l) =>
          manager.create(RfqItem, { rfqId: rfq.id, rawMaterialId: l.rawMaterialId, quantity: Number(l.quantity), unit: l.unit, requisitionItemId: l.requisitionItemId || null }),
        ),
      );
      return rfq.id;
    });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'rfq.created', entityType: 'rfq', entityId: id });
    return this.findOne(id);
  }

  private async openRfq(id: string) {
    const rfq = await this.dataSource.manager.findOne(Rfq, { where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.OPEN) throw new BadRequestException(`${rfq.rfqNumber} is ${rfq.status} - quotes can only change while it is open.`);
    return rfq;
  }

  // Oman VAT: only a VAT-registered supplier adds 5% VAT (same rule as the
  // purchase order), so quotes are compared on what will actually be paid.
  private totals(items: RfqItem[], lines: QuoteLine[], supplier: Supplier) {
    const rate = supplier.vatStatus === SupplierVatStatus.REGISTERED ? 5 : 0;
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const item = items.find((i) => i.id === l.rfqItemId)!;
      const lineTotal = r3(Number(item.quantity) * Number(l.unitPrice));
      subtotal += lineTotal;
      vat += r3((lineTotal * rate) / 100);
    }
    return { subtotal: r3(subtotal), vatAmount: r3(vat), total: r3(subtotal + vat) };
  }

  async saveQuote(rfqId: string, dto: RfqQuoteDto, actor: ApprovalActor, quoteId?: string) {
    const rfq = await this.openRfq(rfqId);
    for (const d of [dto.quoteDate, dto.validUntil]) if (!isDate(d)) throw new BadRequestException('Dates must be YYYY-MM-DD.');
    const supplier = await this.dataSource.manager.findOne(Supplier, { where: { id: dto.supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const items = await this.dataSource.manager.find(RfqItem, { where: { rfqId } });
    const lines: QuoteLine[] = [];
    for (const l of dto.lines) {
      if (!items.some((i) => i.id === l.rfqItemId)) throw new BadRequestException('A quoted line is not part of this RFQ.');
      if (lines.some((x) => x.rfqItemId === l.rfqItemId)) throw new BadRequestException('A line is quoted twice.');
      lines.push({ rfqItemId: l.rfqItemId, unitPrice: r3(Number(l.unitPrice)) });
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const same = await manager.findOne(RfqQuote, { where: { rfqId, supplierId: dto.supplierId } });
      if (same && same.id !== quoteId) throw new BadRequestException(`${supplier.name} already has a quote on this RFQ - edit that one.`);
      const quote = quoteId ? await manager.findOne(RfqQuote, { where: { id: quoteId, rfqId } }) : manager.create(RfqQuote, { rfqId });
      if (!quote) throw new NotFoundException('Quote not found');
      Object.assign(quote, {
        supplierId: dto.supplierId,
        quoteReference: dto.quoteReference?.trim() || null,
        quoteDate: dto.quoteDate || null,
        validUntil: dto.validUntil || null,
        deliveryDays: dto.deliveryDays ?? null,
        notes: dto.notes?.trim() || null,
        lines: JSON.stringify(lines),
        ...this.totals(items, lines, supplier),
      });
      return manager.save(quote);
    });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: quoteId ? 'rfq.quote_updated' : 'rfq.quote_added', entityType: 'rfq', entityId: rfq.id, details: { supplier: supplier.name, total: saved.total } });
    return this.findOne(rfqId);
  }

  async removeQuote(rfqId: string, quoteId: string) {
    await this.openRfq(rfqId);
    await this.dataSource.manager.delete(RfqQuote, { id: quoteId, rfqId });
    return this.findOne(rfqId);
  }

  async cancel(id: string, actor: ApprovalActor) {
    await this.openRfq(id);
    await this.dataSource.manager.update(Rfq, { id, status: RfqStatus.OPEN }, { status: RfqStatus.CANCELLED });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'rfq.cancelled', entityType: 'rfq', entityId: id });
    return this.findOne(id);
  }

  async award(id: string, dto: AwardRfqDto, actor: ApprovalActor) {
    if (!isDate(dto.expectedDate)) throw new BadRequestException('Expected date must be YYYY-MM-DD.');
    const view = await this.findOne(id);
    if (view.status !== RfqStatus.OPEN) throw new BadRequestException(`${view.rfqNumber} is already ${view.status}.`);
    const quote = view.quotes.find((q) => q.id === dto.quoteId);
    if (!quote) throw new NotFoundException('Quote not found on this RFQ');
    if (!quote.complete) throw new BadRequestException(`${quote.supplierName}'s quote does not price every item - it cannot be chosen.`);
    if (quote.validUntil && quote.validUntil < omanToday()) throw new BadRequestException(`${quote.supplierName}'s quote expired on ${quote.validUntil}.`);
    const reason = dto.reason?.trim() || null;
    if (view.lowestQuoteId && view.lowestQuoteId !== quote.id && !reason) {
      throw new BadRequestException('This is not the lowest quote - give the reason for choosing it (kept for audit).');
    }
    const prices = new Map((JSON.parse((await this.dataSource.manager.findOneByOrFail(RfqQuote, { id: quote.id })).lines) as QuoteLine[]).map((l) => [l.rfqItemId, l.unitPrice]));

    const order = await this.dataSource.transaction(async (manager) => {
      const rfq = await manager.findOne(Rfq, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rfq || rfq.status !== RfqStatus.OPEN) throw new BadRequestException('This RFQ changed meanwhile - reload and try again.');
      const items = await manager.find(RfqItem, { where: { rfqId: id } });
      const po = await this.purchaseOrders.create(
        {
          supplierId: quote.supplierId,
          requisitionId: rfq.requisitionId || undefined,
          expectedDate: dto.expectedDate || undefined,
          notes: `From ${rfq.rfqNumber}${quote.quoteReference ? `, supplier quote ${quote.quoteReference}` : ''}`,
          items: items.map((i) => ({
            rawMaterialId: i.rawMaterialId,
            quantity: Number(i.quantity),
            costPerUnit: Number(prices.get(i.id)),
            requisitionItemId: i.requisitionItemId || undefined,
          })),
        },
        actor,
        { rfqId: id, manager },
      );
      rfq.status = RfqStatus.AWARDED;
      rfq.awardedQuoteId = quote.id;
      rfq.awardReason = reason;
      rfq.purchaseOrderId = po.id;
      await manager.save(rfq);
      return po;
    });
    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: 'rfq.awarded',
      entityType: 'rfq',
      entityId: id,
      details: { supplier: quote.supplierName, total: quote.total, lowest: view.lowestQuoteId === quote.id, reason, purchaseOrder: order.poNumber },
    });
    return this.findOne(id);
  }

  // ---- reads ----------------------------------------------------------------

  async findAll() {
    const rfqs = await this.dataSource.manager.find(Rfq, { order: { sequenceNumber: 'DESC' } });
    if (!rfqs.length) return [];
    const ids = rfqs.map((r) => r.id);
    const counts: { rfqId: string; n: string; low: string | null }[] = await this.dataSource.query(
      'SELECT rfqId, COUNT(*) AS n, MIN(total) AS low FROM rfq_quotes WHERE rfqId IN (?) GROUP BY rfqId',
      [ids],
    );
    const pos: { id: string; poNumber: string; status: string }[] = await this.dataSource.query(
      'SELECT id, poNumber, status FROM purchase_orders WHERE rfqId IN (?)',
      [ids],
    );
    const prs: { id: string; prNumber: string }[] = await this.dataSource.query('SELECT id, prNumber FROM purchase_requisitions WHERE id IN (?)', [
      rfqs.map((r) => r.requisitionId || '').concat(''),
    ]);
    return rfqs.map((r) => {
      const c = counts.find((x) => x.rfqId === r.id);
      return {
        ...r,
        quoteCount: Number(c?.n || 0),
        lowestTotal: c?.low === null || c?.low === undefined ? null : Number(c.low),
        purchaseOrder: pos.find((p) => p.id === r.purchaseOrderId) || null,
        prNumber: prs.find((p) => p.id === r.requisitionId)?.prNumber || null,
      };
    });
  }

  async findOne(id: string) {
    const rfq = await this.dataSource.manager.findOne(Rfq, { where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    const items = await this.dataSource.manager.find(RfqItem, { where: { rfqId: id } });
    const quotes = await this.dataSource.manager.find(RfqQuote, { where: { rfqId: id }, order: { total: 'ASC' } });
    const materials = items.length ? await this.dataSource.manager.find(RawMaterial, { where: { id: In(items.map((i) => i.rawMaterialId)) } }) : [];
    const suppliers = quotes.length ? await this.dataSource.manager.find(Supplier, { where: { id: In(quotes.map((q) => q.supplierId)) } }) : [];
    const today = omanToday();
    const quoteViews = quotes.map((q) => {
      const lines = JSON.parse(q.lines) as QuoteLine[];
      const s = suppliers.find((x) => x.id === q.supplierId);
      return {
        ...q,
        subtotal: Number(q.subtotal),
        vatAmount: Number(q.vatAmount),
        total: Number(q.total),
        lines,
        supplierName: s?.name || 'Unknown supplier',
        supplierVatRegistered: s?.vatStatus === SupplierVatStatus.REGISTERED,
        complete: items.every((i) => lines.some((l) => l.rfqItemId === i.id)),
        expired: !!q.validUntil && q.validUntil < today,
      };
    });
    // cheapest complete, still-valid quote (on the total actually paid)
    const eligible = quoteViews.filter((q) => q.complete && !q.expired);
    const lowest = eligible.length ? eligible.reduce((a, b) => (b.total < a.total ? b : a)) : null;
    const itemViews = items.map((i) => {
      const prices = quoteViews
        .map((q) => ({ quoteId: q.id, price: q.lines.find((l) => l.rfqItemId === i.id)?.unitPrice }))
        .filter((p): p is { quoteId: string; price: number } => p.price !== undefined);
      const best = prices.length ? Math.min(...prices.map((p) => p.price)) : null;
      return {
        ...i,
        quantity: Number(i.quantity),
        materialName: materials.find((m) => m.id === i.rawMaterialId)?.name || 'Unknown item',
        lowestPrice: best,
        lowestQuoteIds: prices.filter((p) => p.price === best).map((p) => p.quoteId),
      };
    });
    const [pr] = rfq.requisitionId ? await this.dataSource.query('SELECT prNumber FROM purchase_requisitions WHERE id = ?', [rfq.requisitionId]) : [];
    const [po] = rfq.purchaseOrderId ? await this.dataSource.query('SELECT id, poNumber, status FROM purchase_orders WHERE id = ?', [rfq.purchaseOrderId]) : [];
    return { ...rfq, prNumber: pr?.prNumber || null, purchaseOrder: po || null, items: itemViews, quotes: quoteViews, lowestQuoteId: lowest?.id || null };
  }
}
