import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase-order.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { CreatePurchaseOrderDto } from './dto/supplier.dto';
import { RawMaterialService } from '../inventory/raw-material.service';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { JournalPostingService, PostingLine } from '../journal/journal-posting.service';

interface ActorRef {
  userId?: string;
  email?: string;
}

// Auto-posted Chart-of-Accounts codes for a received Purchase Order —
// matches the DEFAULT_ACCOUNTS seed in journal/account.service.ts. Goes
// to the Inventory asset account (not the "Raw Material Purchases"
// expense account, which is reserved for manual/off-PO Expense entries)
// since receiving stock through a PO increases an asset, not an
// immediate expense.
const INVENTORY_RAW_MATERIALS_CODE = '1200';
const VAT_RECEIVABLE_CODE = '1400';
const ACCOUNTS_PAYABLE_CODE = '2000';

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
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  // subtotal/vatAmount/total across every line — same shape as
  // InvoiceService.calcTotals(), just without a discount concept.
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

  findAll() {
    return this.orderRepo.find();
  }

  // Dashboard's "Payable Bills" list — every RECEIVED purchase order
  // with an outstanding balance (total minus whatever Supplier Payments
  // have been recorded against it — see SupplierPaymentService). Fully
  // paid orders are excluded. Supplier names are attached by
  // ReportingService, same join pattern as
  // getVatReportInRange()/getProductPurchaseBreakdown().
  async getPayableBillsList(limit = 10) {
    const orders = await this.orderRepo.find({ where: { status: PurchaseOrderStatus.RECEIVED } });
    return orders
      .map((o) => {
        const total = Number(o.total || 0);
        const paidAmount = Number(o.paidAmount || 0);
        return {
          id: o.id,
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
    return { ...order, items };
  }

  // Step 1: place the order. Stock is NOT touched yet — only once goods
  // physically arrive (see receive()) does stock actually increase.
  async create(dto: CreatePurchaseOrderDto) {
    const totals = this.calcTotals(dto.items);
    const order = this.orderRepo.create({
      supplierId: dto.supplierId,
      notes: dto.notes,
      status: PurchaseOrderStatus.ORDERED,
      ...totals,
    });
    const savedOrder = await this.orderRepo.save(order);

    const items = dto.items.map((i) =>
      this.itemRepo.create({ ...i, vatRate: i.vatRate ?? 5, purchaseOrderId: savedOrder.id }),
    );
    await this.itemRepo.save(items);

    return { ...savedOrder, items };
  }

  // Step 2: mark as received — this is what actually increases raw
  // material stock, also updating each material's latest cost per unit.
  async receive(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(`Order is already ${order.status}`);
    }

    const items = await this.itemRepo.find({ where: { purchaseOrderId: id } });

    // Whole receipt runs as one transaction: each material's stock/cost
    // update is pessimistic-locked (via RawMaterialService.receiveStock,
    // which blends the new purchase into a weighted-average cost instead
    // of overwriting costPerUnit) and its batch record is created on the
    // SAME transactional manager, so a failure partway through rolls back
    // cleanly instead of leaving some materials updated and others not.
    await this.dataSource.transaction(async (manager) => {
      for (const item of items) {
        await this.rawMaterialService.receiveStock(
          manager,
          item.rawMaterialId,
          Number(item.quantity),
          Number(item.costPerUnit),
        );
        // Batch/Lot Traceability — one traceable lot per line item received,
        // tagged to this PO and its supplier, at THIS line's own purchase
        // cost (the batch keeps the real purchase price even though the
        // material's overall costPerUnit is now a weighted average).
        await this.batchTrackingService.createRawMaterialBatch(manager, {
          rawMaterialId: item.rawMaterialId,
          quantity: Number(item.quantity),
          costPerUnit: Number(item.costPerUnit),
          source: BatchSource.PURCHASE_ORDER,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
        });
      }
    });

    order.status = PurchaseOrderStatus.RECEIVED;
    order.receivedAt = new Date();
    await this.orderRepo.save(order);

    // Auto-post Dr Inventory-Raw-Materials + Dr VAT Receivable / Cr
    // Accounts Payable. Best-effort — the stock/batch updates above
    // already succeeded, so a posting failure here is logged rather than
    // surfacing as an error on receive().
    try {
      const inventoryAccountId = await this.journalPosting.findAccountIdByCode(INVENTORY_RAW_MATERIALS_CODE);
      const apAccountId = await this.journalPosting.findAccountIdByCode(ACCOUNTS_PAYABLE_CODE);
      const subtotal = Number(order.subtotal || 0);
      const vatAmount = Number(order.vatAmount || 0);
      const lines: PostingLine[] = [{ accountId: inventoryAccountId, debit: subtotal, description: 'Raw materials received' }];
      if (vatAmount > 0) {
        const vatAccountId = await this.journalPosting.findAccountIdByCode(VAT_RECEIVABLE_CODE);
        lines.push({ accountId: vatAccountId, debit: vatAmount, description: 'Input VAT' });
      }
      lines.push({ accountId: apAccountId, credit: Number(order.total || 0), description: `PO ${order.id}` });
      await this.journalPosting.postForSource(
        'purchase_order',
        order.id,
        order.receivedAt.toISOString().slice(0, 10),
        `Purchase order received — ${order.id}`,
        lines,
        {},
      );
    } catch (err) {
      console.error(`Auto-posting failed for purchase_order ${order.id}:`, err);
    }

    return { ...order, items };
  }

  // Purchase VAT (Input VAT) report — every RECEIVED order whose
  // receivedAt date falls in range, its own subtotal/vatAmount/total
  // broken out. Supplier names are attached by ReportingService.
  async getVatReportInRange(startDate: string, endDate: string) {
    const orders = await this.orderRepo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: PurchaseOrderStatus.RECEIVED })
      .andWhere('DATE(order.receivedAt) BETWEEN :startDate AND :endDate', { startDate, endDate })
      .orderBy('order.receivedAt', 'ASC')
      .getMany();

    const rows = orders.map((o) => ({
      id: o.id,
      supplierId: o.supplierId,
      receivedAt: o.receivedAt,
      subtotal: Number(o.subtotal || 0),
      vatAmount: Number(o.vatAmount || 0),
      total: Number(o.total || 0),
    }));
    const totalTaxablePurchases = this.round3(rows.reduce((sum, r) => sum + r.subtotal, 0));
    const totalVat = this.round3(rows.reduce((sum, r) => sum + r.vatAmount, 0));
    return { period: { startDate, endDate }, rows, totalTaxablePurchases, totalVat, orderCount: rows.length };
  }

  // Product Purchase report — cost grouped by raw material across every
  // RECEIVED order whose receivedAt date falls in range.
  async getProductPurchaseBreakdown(startDate: string, endDate: string) {
    const orders = await this.orderRepo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: PurchaseOrderStatus.RECEIVED })
      .andWhere('DATE(order.receivedAt) BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getMany();
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];
    const items = await this.itemRepo.find({ where: { purchaseOrderId: In(orderIds) } });

    const byMaterial = new Map<string, { rawMaterialId: string; quantity: number; total: number }>();
    for (const item of items) {
      const lineTotal = this.round3(Number(item.quantity) * Number(item.costPerUnit));
      const existing = byMaterial.get(item.rawMaterialId);
      if (existing) {
        existing.quantity += Number(item.quantity);
        existing.total += lineTotal;
      } else {
        byMaterial.set(item.rawMaterialId, { rawMaterialId: item.rawMaterialId, quantity: Number(item.quantity), total: lineTotal });
      }
    }
    return Array.from(byMaterial.values())
      .map((r) => ({ ...r, quantity: this.round3(r.quantity), total: this.round3(r.total) }))
      .sort((a, b) => b.total - a.total);
  }

  async cancel(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(`Only ordered POs can be cancelled (this one is ${order.status})`);
    }
    order.status = PurchaseOrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }

  // Editing is only allowed before goods are received — once receive()
  // has run, stock/cost-per-unit have already been adjusted from the
  // original items, so changing them afterwards would silently
  // desynchronize inventory from what this order says was purchased.
  async update(id: string, dto: Partial<CreatePurchaseOrderDto>) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(`Only ordered POs can be edited (this one is ${order.status})`);
    }

    if (dto.supplierId) order.supplierId = dto.supplierId;
    if (dto.notes !== undefined) order.notes = dto.notes;
    await this.orderRepo.save(order);

    if (dto.items) {
      const existing = await this.itemRepo.find({ where: { purchaseOrderId: id } });
      if (existing.length > 0) await this.itemRepo.remove(existing);
      const items = dto.items.map((i) => this.itemRepo.create({ ...i, vatRate: i.vatRate ?? 5, purchaseOrderId: id }));
      await this.itemRepo.save(items);
      Object.assign(order, this.calcTotals(dto.items));
      await this.orderRepo.save(order);
      return { ...order, items };
    }
    const items = await this.itemRepo.find({ where: { purchaseOrderId: id } });
    return { ...order, items };
  }

  // Same "only while still ordered" restriction as update() — a
  // received/cancelled order is kept for the audit trail rather than
  // deleted.
  async remove(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.ORDERED) {
      throw new BadRequestException(
        `Only ordered POs can be deleted (this one is ${order.status}) — received/cancelled orders are kept for the audit trail.`,
      );
    }
    const items = await this.itemRepo.find({ where: { purchaseOrderId: id } });
    if (items.length > 0) await this.itemRepo.remove(items);
    await this.orderRepo.remove(order);
    return { deleted: true };
  }
}
