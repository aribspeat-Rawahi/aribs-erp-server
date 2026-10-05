import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase-order.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { GoodsReceipt } from './goods-receipt.entity';
import { GoodsReceiptItem } from './goods-receipt-item.entity';
import { Supplier, SupplierVatStatus } from './supplier.entity';
import { PurchaseReturn, PurchaseReturnStatus } from './purchase-return.entity';
import { CreatePurchaseOrderDto, ReceivePurchaseOrderDto } from './dto/supplier.dto';
import { RawMaterialService } from '../inventory/raw-material.service';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';
import { UnitService } from '../units/unit.service';
import { quantityProblem, formatQtyWithUnit } from '../units/units';
import { computePaymentStatus } from '../invoice/payment-status.util';
import { SettingsService } from '../settings/settings.service';
import { generateInvoicePdf, InvoicePdfItem } from '../common/invoice-pdf.util';
import { RawMaterial } from '../inventory/raw-material.entity';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Auto-posted Chart-of-Accounts codes (journal/account.service.ts seed).
const INVENTORY_RAW_MATERIALS_CODE = '1200';
const VAT_RECEIVABLE_CODE = '1400'; // input VAT
const ACCOUNTS_PAYABLE_CODE = '2000';
const QTY_EPSILON = 0.0005;

// Purchase flow:
//   ordered -> (goods receipts, possibly several) -> partially_received
//   -> received (everything arrived, or the rest closed short)
// Stock, payable and input VAT come in per goods receipt (GRN), so what
// is owed to the supplier is always the value actually received
// (receivedTotal), never the ordered total.
@Injectable()
export class PurchaseOrderService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private itemRepo: Repository<PurchaseOrderItem>,
    private rawMaterialService: RawMaterialService,
    private batchTrackingService: BatchTrackingService,
    @InjectDataSource()
    private dataSource: DataSource,
    private journalPosting: JournalPostingService,
    private units: UnitService,
    private settingsService: SettingsService,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  private calcTotals(items: { quantity: number; costPerUnit: number; vatRate?: number }[]) {
    let subtotal = 0;
    let vatAmount = 0;
    for (const i of items) {
      const lineTotal = this.round3(Number(i.quantity) * Number(i.costPerUnit));
      subtotal += lineTotal;
      vatAmount += this.round3((lineTotal * Number(i.vatRate ?? 5)) / 100);
    }
    subtotal = this.round3(subtotal);
    vatAmount = this.round3(vatAmount);
    return { subtotal, vatAmount, total: this.round3(subtotal + vatAmount) };
  }

  private async getSupplier(id: string) {
    const supplier = await this.dataSource.manager.findOne(Supplier, { where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  // Oman VAT: only a VAT-registered (Omani) supplier charges VAT on its
  // invoice. Not registered -> no VAT; foreign -> no VAT on the supplier's
  // invoice (import VAT is dealt with at customs).
  private lineVat(supplier: Supplier, requested?: number) {
    if (supplier.vatStatus !== SupplierVatStatus.REGISTERED) return 0;
    return requested ?? 5;
  }

  private async resolveLines(dto: CreatePurchaseOrderDto | Partial<CreatePurchaseOrderDto>, supplier: Supplier) {
    if (!dto.items?.length) throw new BadRequestException('Add at least one item.');
    const lines = await this.units.resolveRawMaterialLines(dto.items);
    return lines.map((i) => ({ ...i, vatRate: this.lineVat(supplier, i.vatRate) }));
  }

  private async withItems(orders: PurchaseOrder[]) {
    if (orders.length === 0) return [];
    const items = await this.itemRepo.find({ where: { purchaseOrderId: In(orders.map((o) => o.id)) } });
    const byOrder = new Map<string, PurchaseOrderItem[]>();
    for (const item of items) {
      const list = byOrder.get(item.purchaseOrderId) || [];
      list.push(item);
      byOrder.set(item.purchaseOrderId, list);
    }
    return orders.map((o) => ({ ...o, items: byOrder.get(o.id) || [] }));
  }

  async findAll() {
    return this.withItems(await this.orderRepo.find({ order: { sequenceNumber: 'DESC' } }));
  }

  // Dashboard "Payable Bills": what is owed is the RECEIVED value.
  async getPayableBillsList(limit = 10) {
    const orders = await this.orderRepo.find({
      where: { status: In([PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.PARTIALLY_RECEIVED]) },
    });
    return orders
      .map((o) => {
        const total = Number(o.receivedTotal || 0);
        const paidAmount = Number(o.paidAmount || 0);
        return {
          id: o.id,
          poNumber: o.poNumber,
          supplierId: o.supplierId,
          total,
          paidAmount,
          due: this.round3(Math.max(0, total - paidAmount)),
          receivedAt: o.receivedAt,
        };
      })
      .filter((o) => o.due > 0.001)
      .sort((a, b) => b.due - a.due)
      .slice(0, limit);
  }

  async findOne(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    const items = await this.itemRepo.find({ where: { purchaseOrderId: id } });
    const goodsReceipts = await this.dataSource.manager.find(GoodsReceipt, {
      where: { purchaseOrderId: id },
      relations: ['items'],
      order: { sequenceNumber: 'ASC' },
    });
    return { ...order, items, goodsReceipts };
  }

  async create(dto: CreatePurchaseOrderDto) {
    const supplier = await this.getSupplier(dto.supplierId);
    const lines = await this.resolveLines(dto, supplier);
    const totals = this.calcTotals(lines);
    const saved = await this.dataSource.transaction(async (manager) => {
      const order = await manager.save(
        manager.create(PurchaseOrder, {
          supplierId: dto.supplierId,
          notes: dto.notes,
          expectedDate: dto.expectedDate || null,
          status: PurchaseOrderStatus.ORDERED,
          poNumber: `TMP-${randomUUID().replace(/-/g, '').slice(0, 24)}`, // replaced right after insert, once sequenceNumber is known
          ...totals,
        }),
      );
      order.poNumber = `PO-${new Date().getFullYear()}-${String(order.sequenceNumber).padStart(4, '0')}`;
      await manager.save(order);
      const items = await manager.save(lines.map((i) => manager.create(PurchaseOrderItem, { ...i, purchaseOrderId: order.id })));
      return { ...order, items };
    });
    return saved;
  }

  // ---- receiving (Goods Received Note) ------------------------------------

  async receive(id: string, dto: ReceivePurchaseOrderDto = {}, actor: ActorRef = {}) {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(PurchaseOrder, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('Purchase order not found');
      if (order.status !== PurchaseOrderStatus.ORDERED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
        throw new BadRequestException(`This order is already ${order.status.replace('_', ' ')} - nothing more to receive.`);
      }
      const supplier = await manager.findOne(Supplier, { where: { id: order.supplierId } });
      const items = await manager.find(PurchaseOrderItem, { where: { purchaseOrderId: id }, lock: { mode: 'pessimistic_write' } });
      const remainingOf = (i: PurchaseOrderItem) => this.round3(Number(i.quantity) - Number(i.receivedQuantity || 0));

      // which lines / how much
      let wanted: { item: PurchaseOrderItem; quantity: number }[];
      if (dto.items?.length) {
        wanted = dto.items
          .filter((l) => Number(l.quantity) > 0)
          .map((l) => {
            const item = items.find((i) => i.id === l.purchaseOrderItemId);
            if (!item) throw new BadRequestException('A received line does not belong to this order.');
            return { item, quantity: this.round3(Number(l.quantity)) };
          });
      } else {
        wanted = items.filter((i) => remainingOf(i) > QTY_EPSILON).map((item) => ({ item, quantity: remainingOf(item) }));
      }
      if (!wanted.length) throw new BadRequestException('Enter the quantity that arrived for at least one line.');

      const materials = await manager.find(RawMaterial, { where: { id: In(wanted.map((w) => w.item.rawMaterialId)) } });
      const nameOf = (rid: string) => materials.find((m) => m.id === rid)?.name || 'an item';
      for (const w of wanted) {
        const left = remainingOf(w.item);
        if (w.quantity > left + QTY_EPSILON) {
          throw new BadRequestException(
            `${nameOf(w.item.rawMaterialId)}: only ${formatQtyWithUnit(left, w.item.unit)} is still to come on this order (tried ${formatQtyWithUnit(w.quantity, w.item.unit)}).`,
          );
        }
        const problem = quantityProblem(w.quantity, w.item.unit, nameOf(w.item.rawMaterialId));
        if (problem) throw new BadRequestException(problem);
      }

      // amounts (price and VAT from the PO line)
      const grnLines = wanted.map((w) => {
        const lineTotal = this.round3(w.quantity * Number(w.item.costPerUnit));
        return { ...w, lineTotal, vat: this.round3((lineTotal * Number(w.item.vatRate)) / 100) };
      });
      const subtotal = this.round3(grnLines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = this.round3(grnLines.reduce((s, l) => s + l.vat, 0));
      const total = this.round3(subtotal + vatAmount);

      // Oman VAT: input VAT can only be claimed with the supplier's tax invoice.
      const invoiceNo = dto.supplierInvoiceNumber?.trim();
      if (vatAmount > 0 && (!invoiceNo || !dto.supplierInvoiceDate)) {
        throw new BadRequestException("This delivery carries VAT - enter the supplier's tax invoice number and date (needed to claim the input VAT).");
      }

      const receivedDate = dto.receivedDate || this.todayStr();
      const grn = await manager.save(
        manager.create(GoodsReceipt, {
          grnNumber: `TMP-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          receivedDate,
          supplierInvoiceNumber: invoiceNo || null,
          supplierInvoiceDate: dto.supplierInvoiceDate || null,
          subtotal,
          vatAmount,
          total,
          note: dto.note || null,
          createdByUserId: actor.userId || null,
          createdByEmail: actor.email || null,
        }),
      );
      grn.grnNumber = `GRN-${new Date().getFullYear()}-${String(grn.sequenceNumber).padStart(4, '0')}`;
      await manager.save(grn);

      for (const l of grnLines) {
        await manager.save(
          manager.create(GoodsReceiptItem, {
            goodsReceiptId: grn.id,
            purchaseOrderItemId: l.item.id,
            rawMaterialId: l.item.rawMaterialId,
            quantity: l.quantity,
            unit: l.item.unit,
            costPerUnit: Number(l.item.costPerUnit),
            vatRate: Number(l.item.vatRate),
            lineTotal: l.lineTotal,
          }),
        );
        // stock (weighted-average cost) + a traceable batch for this delivery
        await this.rawMaterialService.receiveStock(manager, l.item.rawMaterialId, l.quantity, Number(l.item.costPerUnit));
        const batch = await this.batchTrackingService.createRawMaterialBatch(manager, {
          rawMaterialId: l.item.rawMaterialId,
          quantity: l.quantity,
          costPerUnit: Number(l.item.costPerUnit),
          source: BatchSource.PURCHASE_ORDER,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          notes: `${grn.grnNumber} / ${order.poNumber}`,
        });
        batch.goodsReceiptId = grn.id;
        await manager.save(batch);
        l.item.receivedQuantity = this.round3(Number(l.item.receivedQuantity || 0) + l.quantity);
        await manager.save(l.item);
      }

      order.receivedSubtotal = this.round3(Number(order.receivedSubtotal || 0) + subtotal);
      order.receivedVat = this.round3(Number(order.receivedVat || 0) + vatAmount);
      order.receivedTotal = this.round3(Number(order.receivedTotal || 0) + total);
      const allIn = items.every((i) => remainingOf(i) <= QTY_EPSILON);
      order.status = allIn ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
      if (allIn) order.receivedAt = new Date();
      order.paymentStatus = computePaymentStatus(Number(order.paidAmount || 0), Number(order.receivedTotal));
      await manager.save(order);
      return { order, grn, supplierName: supplier?.name || '' };
    });

    // Dr Raw Materials Inventory + Dr Input VAT / Cr Accounts Payable,
    // one entry per goods receipt, dated the day the goods arrived.
    const { order, grn } = result;
    try {
      const lines: PostingLine[] = [
        { accountId: await this.journalPosting.findAccountIdByCode(INVENTORY_RAW_MATERIALS_CODE), debit: Number(grn.subtotal), description: 'Raw materials received' },
      ];
      if (Number(grn.vatAmount) > 0) {
        lines.push({
          accountId: await this.journalPosting.findAccountIdByCode(VAT_RECEIVABLE_CODE),
          debit: Number(grn.vatAmount),
          description: `Input VAT - supplier invoice ${grn.supplierInvoiceNumber}`,
        });
      }
      lines.push({ accountId: await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE), credit: Number(grn.total), description: `${order.poNumber} / ${grn.grnNumber}` });
      await this.journalPosting.postForSource('goods_receipt', grn.id, grn.receivedDate, `Goods received ${grn.grnNumber} - ${order.poNumber}`, lines, actor, grn.grnNumber);
    } catch (err) {
      console.error(`Auto-posting failed for goods_receipt ${grn.id}:`, err);
    }
    return this.findOne(order.id);
  }

  // The rest of a partially received order will not come: close it. What
  // is owed stays the received value; nothing else moves.
  async closeShort(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Only a partially received order can be closed.');
    }
    order.status = PurchaseOrderStatus.RECEIVED;
    order.closedShort = true;
    order.receivedAt = new Date();
    await this.orderRepo.save(order);
    return this.findOne(id);
  }

  // Suppliers > Not Received Yet: orders still waiting for goods.
  async findPendingReceipts() {
    const orders = await this.withItems(
      await this.orderRepo.find({
        where: { status: In([PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED]) },
        order: { expectedDate: 'ASC', sequenceNumber: 'ASC' },
      }),
    );
    const today = this.todayStr();
    const suppliers = await this.dataSource.manager.find(Supplier, { where: { id: In([...new Set(orders.map((o) => o.supplierId))].concat('')) } });
    return orders.map((o) => ({
      ...o,
      supplierName: suppliers.find((s) => s.id === o.supplierId)?.name || '',
      overdue: !!o.expectedDate && o.expectedDate < today,
      items: o.items.map((i) => ({ ...i, remainingQuantity: this.round3(Number(i.quantity) - Number(i.receivedQuantity || 0)) })),
    }));
  }

  // ---- reports ----------------------------------------------------------

  // Purchase VAT (input VAT) for a period - per goods receipt (the tax
  // point is when the goods and the supplier's tax invoice arrive), less
  // the input VAT reversed by approved purchase returns (debit notes).
  async getVatReportInRange(startDate: string, endDate: string) {
    const grns = await this.dataSource.manager
      .createQueryBuilder(GoodsReceipt, 'g')
      .where('g.receivedDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      .orderBy('g.receivedDate', 'ASC')
      .getMany();
    const returns = await this.dataSource.manager
      .createQueryBuilder(PurchaseReturn, 'r')
      .where('r.status = :status', { status: PurchaseReturnStatus.APPROVED })
      .andWhere('r.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    const orderIds = [...new Set([...grns.map((g) => g.purchaseOrderId), ...returns.map((r) => r.purchaseOrderId)])];
    const orders = orderIds.length ? await this.orderRepo.find({ where: { id: In(orderIds) } }) : [];
    const supplierIds = [...new Set([...grns.map((g) => g.supplierId), ...returns.map((r) => r.supplierId)])];
    const suppliers = supplierIds.length ? await this.dataSource.manager.find(Supplier, { where: { id: In(supplierIds) } }) : [];
    const supplierOf = (sid: string) => suppliers.find((s) => s.id === sid);
    const poNumberOf = (pid: string) => orders.find((o) => o.id === pid)?.poNumber || '';

    const rows = [
      ...grns.map((g) => {
        const s = supplierOf(g.supplierId);
        const vat = Number(g.vatAmount || 0);
        return {
          type: 'goods_receipt' as const,
          id: g.id,
          reference: g.grnNumber,
          poNumber: poNumberOf(g.purchaseOrderId),
          supplierId: g.supplierId,
          supplierName: s?.name || '',
          supplierVatin: s?.vatin || '',
          supplierInvoiceNumber: g.supplierInvoiceNumber || '',
          supplierInvoiceDate: g.supplierInvoiceDate || '',
          date: g.receivedDate,
          receivedAt: g.receivedDate,
          subtotal: Number(g.subtotal || 0),
          vatAmount: vat,
          total: Number(g.total || 0),
          missing: vat > 0 ? [!s?.vatin && 'supplier VATIN', !g.supplierInvoiceNumber && 'tax invoice no.'].filter(Boolean) : [],
        };
      }),
      ...returns.map((r) => {
        const s = supplierOf(r.supplierId);
        return {
          type: 'debit_note' as const,
          id: r.id,
          reference: r.returnNumber,
          poNumber: poNumberOf(r.purchaseOrderId),
          supplierId: r.supplierId,
          supplierName: s?.name || '',
          supplierVatin: s?.vatin || '',
          supplierInvoiceNumber: '',
          supplierInvoiceDate: '',
          date: r.date,
          receivedAt: r.date,
          subtotal: -Number(r.subtotal || 0),
          vatAmount: -Number(r.vatAmount || 0),
          total: -Number(r.total || 0),
          missing: [] as string[],
        };
      }),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const totalTaxablePurchases = this.round3(rows.reduce((sum, r) => sum + r.subtotal, 0));
    const totalVat = this.round3(rows.reduce((sum, r) => sum + r.vatAmount, 0));
    return {
      period: { startDate, endDate },
      rows,
      totalTaxablePurchases,
      totalVat,
      debitNotesVat: this.round3(returns.reduce((s, r) => s + Number(r.vatAmount || 0), 0)),
      orderCount: grns.length,
      rowsMissingDocuments: rows.filter((r) => r.missing.length > 0).length,
    };
  }

  // Purchases by material - what was actually received in the period.
  async getProductPurchaseBreakdown(startDate: string, endDate: string) {
    const grns = await this.dataSource.manager
      .createQueryBuilder(GoodsReceipt, 'g')
      .where('g.receivedDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    if (grns.length === 0) return [];
    const items = await this.dataSource.manager.find(GoodsReceiptItem, { where: { goodsReceiptId: In(grns.map((g) => g.id)) } });
    const byMaterial = new Map<string, { rawMaterialId: string; quantity: number; total: number }>();
    for (const item of items) {
      const existing = byMaterial.get(item.rawMaterialId);
      if (existing) {
        existing.quantity += Number(item.quantity);
        existing.total += Number(item.lineTotal);
      } else {
        byMaterial.set(item.rawMaterialId, { rawMaterialId: item.rawMaterialId, quantity: Number(item.quantity), total: Number(item.lineTotal) });
      }
    }
    return Array.from(byMaterial.values())
      .map((r) => ({ ...r, quantity: this.round3(r.quantity), total: this.round3(r.total) }))
      .sort((a, b) => b.total - a.total);
  }

  // ---- edit / cancel / delete (only while nothing has arrived) ---------

  async cancel(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(
        order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
          ? 'Part of this order has arrived - use "Close" instead of cancel.'
          : `Only ordered POs can be cancelled (this one is ${order.status})`,
      );
    }
    order.status = PurchaseOrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }

  async update(id: string, dto: Partial<CreatePurchaseOrderDto>) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(`Only ordered POs can be edited (this one is ${order.status.replace('_', ' ')})`);
    }
    if (dto.supplierId) order.supplierId = dto.supplierId;
    if (dto.notes !== undefined) order.notes = dto.notes;
    if (dto.expectedDate !== undefined) order.expectedDate = dto.expectedDate || null;
    const supplier = await this.getSupplier(order.supplierId);

    let items = await this.itemRepo.find({ where: { purchaseOrderId: id } });
    if (dto.items || dto.supplierId) {
      // re-apply the VAT rule when the supplier changes, too
      const source = dto.items
        ? dto.items
        : items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity), costPerUnit: Number(i.costPerUnit), vatRate: Number(i.vatRate) }));
      const lines = await this.resolveLines({ items: source }, supplier);
      await this.dataSource.transaction(async (manager) => {
        if (items.length) await manager.remove(items);
        items = await manager.save(lines.map((i) => manager.create(PurchaseOrderItem, { ...i, purchaseOrderId: id })));
        Object.assign(order, this.calcTotals(lines));
        await manager.save(order);
      });
    } else {
      await this.orderRepo.save(order);
    }
    return { ...order, items };
  }

  async remove(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(
        `Only ordered POs can be deleted (this one is ${order.status.replace('_', ' ')}) — received/cancelled orders are kept for the audit trail.`,
      );
    }
    const items = await this.itemRepo.find({ where: { purchaseOrderId: id } });
    if (items.length > 0) await this.itemRepo.remove(items);
    await this.orderRepo.remove(order);
    return { deleted: true };
  }

  // ---- PDF -------------------------------------------------------------

  // Purchase order to send to the supplier (same layouts as invoices).
  async generatePdf(id: string) {
    const order = await this.findOne(id);
    const supplier = await this.getSupplier(order.supplierId);
    const settings = await this.settingsService.get();
    const logoBase64 = await this.settingsService.getLogoBase64();
    const materials = await this.dataSource.manager.find(RawMaterial, { where: { id: In(order.items.map((i) => i.rawMaterialId).concat('')) } });
    const items: InvoicePdfItem[] = order.items.map((i) => ({
      description: materials.find((m) => m.id === i.rawMaterialId)?.name || 'Item',
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.costPerUnit),
      vatRate: Number(i.vatRate),
      lineTotal: this.round3(Number(i.quantity) * Number(i.costPerUnit)),
    }));
    return generateInvoicePdf({
      invoiceNumber: order.poNumber,
      version: 1,
      issueDate: new Date(order.createdAt).toISOString().slice(0, 10),
      deliveryDate: order.expectedDate || undefined,
      companyName: settings.companyName,
      companyVatin: settings.companyVatin || 'OM1000000000',
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      customerName: supplier.name,
      customerAddress: supplier.address,
      customerPhone: supplier.phone,
      customerVatin: supplier.vatin || undefined,
      items,
      grossAmount: Number(order.subtotal || 0),
      discountAmount: 0,
      taxableAmount: Number(order.subtotal || 0),
      vatAmount: Number(order.vatAmount || 0),
      netAmount: Number(order.total || 0),
      vatExcluded: false,
      logoBase64,
      template: settings.defaultInvoiceTemplate,
      documentType: 'purchase_order',
      partyLabel: 'SUPPLIER',
    });
  }
}
