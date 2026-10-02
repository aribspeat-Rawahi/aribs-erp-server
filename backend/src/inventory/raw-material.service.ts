import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { RawMaterial } from './raw-material.entity';
import { CreateRawMaterialDto, AdjustStockDto, AddStockDto } from './dto/raw-material.dto';
import { BillOfMaterial } from '../manufacturing/bom.entity';
import { PurchaseOrder, PurchaseOrderStatus } from '../supplier/purchase-order.entity';
import { PurchaseOrderItem } from '../supplier/purchase-order-item.entity';
import { BatchTrackingService } from './batch-tracking.service';
import { BatchSource } from './batch-source.enum';

@Injectable()
export class RawMaterialService {
  constructor(
    @InjectRepository(RawMaterial)
    private repo: Repository<RawMaterial>,
    @InjectRepository(BillOfMaterial)
    private bomRepo: Repository<BillOfMaterial>,
    @InjectRepository(PurchaseOrder)
    private purchaseOrderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private purchaseOrderItemRepo: Repository<PurchaseOrderItem>,
    @InjectDataSource()
    private dataSource: DataSource,
    private batchTrackingService: BatchTrackingService,
  ) {}

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Raw material not found');
    return item;
  }

  create(dto: CreateRawMaterialDto) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  // quantityInStock is deliberately never accepted here — changing stock
  // without a batch record or a journal entry would silently desync
  // Inventory Reports and the Chart-of-Accounts Inventory balance. Use
  // addStock() (opening stock/corrections) or adjustStock() (production
  // consumption) instead, both of which create a proper trail.
  async update(id: string, dto: Partial<CreateRawMaterialDto>) {
    const item = await this.findOne(id);
    const { quantityInStock, ...safeDto } = dto;
    Object.assign(item, safeDto);
    return this.repo.save(item);
  }

  // Used by: (a) Supplier/Purchase module when raw material arrives,
  // (b) Production module when a production order consumes material.
  // Wrapped in a transaction with a pessimistic write lock so concurrent
  // adjustments against the same row serialize instead of racing on a
  // stale read-then-write.
  async adjustStock(id: string, dto: AdjustStockDto) {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(RawMaterial, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Raw material not found');
      const newQty = Number(item.quantityInStock) + Number(dto.quantityChange);
      if (newQty < 0) {
        throw new BadRequestException(
          `Insufficient stock for ${item.name}. Available: ${item.quantityInStock}`,
        );
      }
      item.quantityInStock = newQty;
      const saved = await manager.save(item);
      return {
        item: saved,
        isLowStock: newQty <= Number(item.lowStockThreshold),
      };
    });
  }

  // Inventory "Add stock" modal — the direct, batch-tracked way to add
  // raw material stock outside of a Purchase Order receive (opening
  // stock, a stock-count correction, a sample delivery, etc). Unlike
  // adjustStock() above, this creates a real, traceable RawMaterialBatch
  // (source: MANUAL) and updates costPerUnit as a weighted average, the
  // same pattern used for FinishedGood.costPerUnit in
  // ProductionOrderService.complete().
  async addStock(id: string, dto: AddStockDto) {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(RawMaterial, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Raw material not found');

      const addQty = Number(dto.quantity);
      const existingQty = Number(item.quantityInStock);
      const existingCost = Number(item.costPerUnit);
      // This lot's cost — defaults to the material's current cost if left
      // blank (e.g. a stock-count correction with no new purchase price).
      const batchCost = dto.costPerUnit !== undefined ? Number(dto.costPerUnit) : existingCost;

      const newQty = existingQty + addQty;
      item.costPerUnit = newQty > 0 ? (existingQty * existingCost + addQty * batchCost) / newQty : existingCost;
      item.quantityInStock = newQty;
      const saved = await manager.save(item);

      await this.batchTrackingService.createRawMaterialBatch(manager, {
        rawMaterialId: item.id,
        quantity: addQty,
        costPerUnit: batchCost,
        source: BatchSource.MANUAL,
        notes: dto.notes,
      });

      return saved;
    });
  }

  // Weighted-average stock increase used by PurchaseOrderService.receive()
  // when a purchase order's goods arrive. Same blending math as addStock()
  // above ( newCost = (existingQty*existingCost + addQty*batchCost) / newQty,
  // guarded against divide-by-zero), but takes the CALLER's own
  // transactional EntityManager (so it runs inside receive()'s single
  // transaction alongside that PO line's batch record) and leaves batch
  // creation to the caller, which tags the batch with PO/supplier info.
  // Bug fix (2026-09-28): previously PurchaseOrderService.receive() called
  // adjustStock() (quantity only) then update({ costPerUnit }) — the
  // second call OVERWROTE costPerUnit with the new purchase's price
  // instead of blending it with existing stock, silently inflating/
  // deflating the material's average cost on every purchase.
  async receiveStock(manager: EntityManager, id: string, quantity: number, costPerUnit: number) {
    const item = await manager.findOne(RawMaterial, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) throw new NotFoundException('Raw material not found');

    const addQty = Number(quantity);
    const existingQty = Number(item.quantityInStock);
    const existingCost = Number(item.costPerUnit);
    const batchCost = Number(costPerUnit);

    const newQty = existingQty + addQty;
    item.costPerUnit = newQty > 0 ? (existingQty * existingCost + addQty * batchCost) / newQty : existingCost;
    item.quantityInStock = newQty;
    return manager.save(item);
  }

  async findLowStock() {
    const all = await this.repo.find();
    return all.filter(
      (m) => Number(m.quantityInStock) <= Number(m.lowStockThreshold),
    );
  }

  // Deleting a raw material is blocked whenever it could silently break
  // something else in the app:
  // - still has stock (must be adjusted to zero first, so the value isn't
  //   just discarded without a trace)
  // - used in a recipe (BOM) — a production run would fail with a
  //   confusing "raw material not found" instead of a clear message
  // - referenced by a not-yet-received Purchase Order — receive() would
  //   fail the same way once someone tries to mark it received
  // Historical records (old received POs, batch trace rows) are NOT
  // blocked on — those are audit history and will just show "Unknown
  // material" if looked up after deletion, same as how a hard-deleted
  // Employee leaves orphaned but harmless Attendance/Payroll rows.
  async remove(id: string) {
    const item = await this.findOne(id);

    if (Number(item.quantityInStock) > 0.001) {
      throw new BadRequestException(
        `Cannot delete ${item.name} — it still has ${item.quantityInStock} ${item.unit} in stock. Adjust stock to zero first.`,
      );
    }

    const bomCount = await this.bomRepo.count({ where: { rawMaterialId: id } });
    if (bomCount > 0) {
      throw new BadRequestException(
        `Cannot delete ${item.name} — it's used in ${bomCount} recipe(s). Remove it from those recipes (BOM) first.`,
      );
    }

    const pendingPoItems = await this.purchaseOrderItemRepo.find({ where: { rawMaterialId: id } });
    if (pendingPoItems.length > 0) {
      const pendingOrderIds = [...new Set(pendingPoItems.map((i) => i.purchaseOrderId))];
      const orderedCount = await this.purchaseOrderRepo.count({
        where: { id: In(pendingOrderIds), status: PurchaseOrderStatus.ORDERED },
      });
      if (orderedCount > 0) {
        throw new BadRequestException(
          `Cannot delete ${item.name} — it's on a purchase order that hasn't been received yet. Cancel or receive that order first.`,
        );
      }
    }

    await this.repo.remove(item);
    return { deleted: true };
  }

  // Inventory Reorder Automation — every raw material at/below its
  // lowStockThreshold, grouped by supplierId so each group can become a
  // one-click "Create Purchase Order" draft. Materials with no
  // supplierId set are grouped under `supplierId: null` ("Unassigned" in
  // the UI) since there's nowhere to send that PO yet.
  //
  // This only ever COMPUTES suggestions — it never creates a real
  // PurchaseOrder itself, so a person always reviews and confirms before
  // anything financial is created (same instinct as the rest of this
  // app's approval-gated flows).
  async getReorderSuggestions() {
    const low = await this.findLowStock();
    const bySupplier = new Map<string | null, typeof low>();
    for (const m of low) {
      const key = m.supplierId || null;
      const list = bySupplier.get(key) || [];
      list.push(m);
      bySupplier.set(key, list);
    }

    const groups = Array.from(bySupplier.entries()).map(([supplierId, materials]) => ({
      supplierId,
      items: materials.map((m) => {
        const quantityInStock = Number(m.quantityInStock);
        const lowStockThreshold = Number(m.lowStockThreshold);
        const reorderQuantity = m.reorderQuantity != null ? Number(m.reorderQuantity) : null;
        // Fallback when no explicit reorderQuantity is set: order enough
        // to get back above the threshold, with a small buffer so it
        // doesn't immediately re-trigger — same threshold again.
        const suggestedQuantity =
          reorderQuantity && reorderQuantity > 0
            ? reorderQuantity
            : Math.max(lowStockThreshold * 2 - quantityInStock, lowStockThreshold, 0.001);
        return {
          rawMaterialId: m.id,
          name: m.name,
          unit: m.unit,
          quantityInStock,
          lowStockThreshold,
          costPerUnit: Number(m.costPerUnit),
          suggestedQuantity: Math.round(suggestedQuantity * 1000) / 1000,
          isExplicitReorderQuantity: !!(reorderQuantity && reorderQuantity > 0),
        };
      }),
    }));

    return { groups, totalItems: low.length };
  }
}
