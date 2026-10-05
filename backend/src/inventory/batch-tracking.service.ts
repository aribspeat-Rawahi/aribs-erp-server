import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThan, Repository, In } from 'typeorm';
import { RawMaterialBatch } from './raw-material-batch.entity';
import { FinishedGoodBatch } from './finished-good-batch.entity';
import { ProductionBatchConsumption } from '../manufacturing/production-batch-consumption.entity';
import { SalesBatchConsumption } from '../sales/sales-batch-consumption.entity';
import { RawMaterial } from './raw-material.entity';
import { FinishedGood } from './finished-good.entity';
import { BatchSource } from './batch-source.enum';

// A quantity this small is treated as "fully consumed" — guards against
// leftover fractions from repeated decimal subtraction.
const EPSILON = 0.0000001;

@Injectable()
export class BatchTrackingService {
  constructor(
    @InjectRepository(RawMaterialBatch)
    private rawBatchRepo: Repository<RawMaterialBatch>,
    @InjectRepository(FinishedGoodBatch)
    private finishedBatchRepo: Repository<FinishedGoodBatch>,
    @InjectRepository(ProductionBatchConsumption)
    private productionConsumptionRepo: Repository<ProductionBatchConsumption>,
    @InjectRepository(SalesBatchConsumption)
    private salesConsumptionRepo: Repository<SalesBatchConsumption>,
  ) {}

  private generateBatchNumber(prefix: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${date}-${rand}`;
  }

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // Raw material IN — one row per Purchase Order line item received, or
  // an Opening Balance / manual top-up row created internally.
  async createRawMaterialBatch(
    manager: EntityManager,
    opts: {
      rawMaterialId: string;
      quantity: number;
      costPerUnit: number;
      source: BatchSource;
      purchaseOrderId?: string;
      supplierId?: string;
      notes?: string;
    },
  ) {
    const batch = manager.create(RawMaterialBatch, {
      rawMaterialId: opts.rawMaterialId,
      batchNumber: this.generateBatchNumber('RM'),
      quantityReceived: opts.quantity,
      quantityRemaining: opts.quantity,
      costPerUnit: opts.costPerUnit,
      source: opts.source,
      purchaseOrderId: opts.purchaseOrderId,
      supplierId: opts.supplierId,
      notes: opts.notes,
      receivedDate: this.todayStr(),
    });
    return manager.save(batch);
  }

  // Finished good IN — one row per Production Order completion, or a
  // manual/barcode stock-in, or an Opening Balance row created internally.
  async createFinishedGoodBatch(
    manager: EntityManager,
    opts: { finishedGoodId: string; quantity: number; source: BatchSource; productionOrderId?: string },
  ) {
    const batch = manager.create(FinishedGoodBatch, {
      finishedGoodId: opts.finishedGoodId,
      batchNumber: this.generateBatchNumber('FG'),
      quantityProduced: opts.quantity,
      quantityRemaining: opts.quantity,
      source: opts.source,
      productionOrderId: opts.productionOrderId,
      producedDate: this.todayStr(),
    });
    return manager.save(batch);
  }

  // First time a material is ever consumed through batch tracking, if it
  // already has stock but no batch history (pre-dates this feature, or a
  // manual adjust-stock that bypassed batching), snapshot the current
  // stock as one traceable "Opening Balance" lot so FIFO always has
  // something real to draw from.
  private async ensureRawMaterialOpeningBalance(manager: EntityManager, rawMaterialId: string) {
    const existing = await manager.count(RawMaterialBatch, { where: { rawMaterialId } });
    if (existing > 0) return;
    const material = await manager.findOne(RawMaterial, { where: { id: rawMaterialId } });
    if (!material || Number(material.quantityInStock) <= 0) return;
    await this.createRawMaterialBatch(manager, {
      rawMaterialId,
      quantity: Number(material.quantityInStock),
      costPerUnit: Number(material.costPerUnit),
      source: BatchSource.OPENING_BALANCE,
    });
  }

  private async ensureFinishedGoodOpeningBalance(manager: EntityManager, finishedGoodId: string) {
    const existing = await manager.count(FinishedGoodBatch, { where: { finishedGoodId } });
    if (existing > 0) return;
    const good = await manager.findOne(FinishedGood, { where: { id: finishedGoodId } });
    if (!good || Number(good.quantityInStock) <= 0) return;
    await this.createFinishedGoodBatch(manager, {
      finishedGoodId,
      quantity: Number(good.quantityInStock),
      source: BatchSource.OPENING_BALANCE,
    });
  }

  // Consumes `quantity` of a raw material from its oldest batches first
  // (FIFO by receivedDate), recording which batch(es) fed the given
  // finished-good batch. Call this BEFORE mutating RawMaterial.quantityInStock
  // so the opening-balance snapshot (if needed) captures pre-consumption stock.
  //
  // If batches run out before `quantity` is fully accounted for (only
  // possible from drift — e.g. a manual adjust-stock call that bypassed
  // batching), the shortfall is topped up as a zero-cost Opening Balance
  // batch rather than blocking production: the caller's own stock check
  // already confirmed real stock is sufficient, so this never breaks an
  // otherwise-valid Production Order — it just means that sliver of
  // material won't trace back to a real Purchase Order/supplier.
  async consumeRawMaterialFifo(
    manager: EntityManager,
    opts: { rawMaterialId: string; quantity: number; productionOrderId: string; finishedGoodBatchId: string },
  ) {
    await this.ensureRawMaterialOpeningBalance(manager, opts.rawMaterialId);

    let remaining = Number(opts.quantity);
    const batches = await manager.find(RawMaterialBatch, {
      where: { rawMaterialId: opts.rawMaterialId, quantityRemaining: MoreThan(0) },
      order: { receivedDate: 'ASC', createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    for (const batch of batches) {
      if (remaining <= EPSILON) break;
      const take = Math.min(Number(batch.quantityRemaining), remaining);
      batch.quantityRemaining = Number(batch.quantityRemaining) - take;
      await manager.save(batch);
      await manager.save(
        manager.create(ProductionBatchConsumption, {
          productionOrderId: opts.productionOrderId,
          finishedGoodBatchId: opts.finishedGoodBatchId,
          rawMaterialBatchId: batch.id,
          rawMaterialId: opts.rawMaterialId,
          quantityConsumed: take,
        }),
      );
      remaining -= take;
    }

    if (remaining > EPSILON) {
      const topUp = await this.createRawMaterialBatch(manager, {
        rawMaterialId: opts.rawMaterialId,
        quantity: remaining,
        costPerUnit: 0,
        source: BatchSource.OPENING_BALANCE,
      });
      topUp.quantityRemaining = 0;
      await manager.save(topUp);
      await manager.save(
        manager.create(ProductionBatchConsumption, {
          productionOrderId: opts.productionOrderId,
          finishedGoodBatchId: opts.finishedGoodBatchId,
          rawMaterialBatchId: topUp.id,
          rawMaterialId: opts.rawMaterialId,
          quantityConsumed: remaining,
        }),
      );
    }
  }

  // Goods sent back to the supplier (approved purchase return): taken out
  // of that order's own batches first (oldest first), then any other
  // batch of the material, so batches keep matching real stock.
  async consumeRawMaterialForReturn(manager: EntityManager, opts: { rawMaterialId: string; quantity: number; purchaseOrderId: string }) {
    await this.ensureRawMaterialOpeningBalance(manager, opts.rawMaterialId);
    let remaining = Number(opts.quantity);
    const batches = await manager.find(RawMaterialBatch, {
      where: { rawMaterialId: opts.rawMaterialId, quantityRemaining: MoreThan(0) },
      order: { receivedDate: 'ASC', createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const ordered = [...batches.filter((b) => b.purchaseOrderId === opts.purchaseOrderId), ...batches.filter((b) => b.purchaseOrderId !== opts.purchaseOrderId)];
    for (const batch of ordered) {
      if (remaining <= EPSILON) break;
      const take = Math.min(Number(batch.quantityRemaining), remaining);
      batch.quantityRemaining = Math.round((Number(batch.quantityRemaining) - take) * 1000) / 1000;
      await manager.save(batch);
      remaining -= take;
    }
  }

  // Same FIFO idea for finished goods — consumed by a Sales Order or a
  // manual/barcode stock-out. Call BEFORE mutating FinishedGood.quantityInStock.
  async consumeFinishedGoodFifo(
    manager: EntityManager,
    opts: { finishedGoodId: string; quantity: number; salesOrderId?: string; invoiceId?: string; noTopUp?: boolean },
  ) {
    await this.ensureFinishedGoodOpeningBalance(manager, opts.finishedGoodId);

    let remaining = Number(opts.quantity);
    const batches = await manager.find(FinishedGoodBatch, {
      where: { finishedGoodId: opts.finishedGoodId, quantityRemaining: MoreThan(0) },
      order: { producedDate: 'ASC', createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    for (const batch of batches) {
      if (remaining <= EPSILON) break;
      const take = Math.min(Number(batch.quantityRemaining), remaining);
      batch.quantityRemaining = Number(batch.quantityRemaining) - take;
      await manager.save(batch);
      await manager.save(
        manager.create(SalesBatchConsumption, {
          salesOrderId: opts.salesOrderId,
          invoiceId: opts.invoiceId || null,
          finishedGoodBatchId: batch.id,
          finishedGoodId: opts.finishedGoodId,
          quantityConsumed: take,
        }),
      );
      remaining -= take;
    }

    if (remaining > EPSILON && !opts.noTopUp) {
      const topUp = await this.createFinishedGoodBatch(manager, {
        finishedGoodId: opts.finishedGoodId,
        quantity: remaining,
        source: BatchSource.OPENING_BALANCE,
      });
      topUp.quantityRemaining = 0;
      await manager.save(topUp);
      await manager.save(
        manager.create(SalesBatchConsumption, {
          salesOrderId: opts.salesOrderId,
          invoiceId: opts.invoiceId || null,
          finishedGoodBatchId: topUp.id,
          finishedGoodId: opts.finishedGoodId,
          quantityConsumed: remaining,
        }),
      );
    }
  }

  // Stock can go below zero (invoices sell goods not made yet). When stock
  // then comes in, the part that fills that gap was already sold, so it is
  // taken straight back out of the new batch(es) - batches stay equal to
  // real stock. Call AFTER creating the new batch, with the stock level
  // from BEFORE the increase.
  async absorbBackorder(manager: EntityManager, finishedGoodId: string, stockBefore: number, added: number) {
    const backorder = Math.max(0, -Number(stockBefore));
    const qty = Math.min(backorder, Number(added));
    if (qty <= EPSILON) return;
    await this.consumeFinishedGoodFifo(manager, { finishedGoodId, quantity: qty, noTopUp: true });
  }

  // Removes a product's batches and their trace rows (used when the
  // product itself is deleted, stock 0). .remove() so the Activity Log
  // undo can put them back.
  async removeFinishedGoodBatches(finishedGoodId: string) {
    const batches = await this.finishedBatchRepo.find({ where: { finishedGoodId } });
    await this.removeBatchRows(batches);
  }

  // Admin: delete a leftover batch whose product no longer exists. A
  // batch of an existing product is part of its stock and can't go alone.
  async removeOrphanFinishedBatch(id: string) {
    const batch = await this.finishedBatchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');
    const product = await this.finishedBatchRepo.manager.findOne(FinishedGood, { where: { id: batch.finishedGoodId } });
    if (product) {
      throw new BadRequestException(
        `This batch is part of ${product.name}'s stock. Stock it out or delete the product instead - its batches are removed with it.`,
      );
    }
    await this.removeBatchRows([batch]);
    return { deleted: true };
  }

  private async removeBatchRows(batches: FinishedGoodBatch[]) {
    if (!batches.length) return;
    const ids = batches.map((b) => b.id);
    const manager = this.finishedBatchRepo.manager;
    const sales = await manager.find(SalesBatchConsumption, { where: { finishedGoodBatchId: In(ids) } });
    if (sales.length) await manager.remove(sales);
    const production = await manager.find(ProductionBatchConsumption, { where: { finishedGoodBatchId: In(ids) } });
    if (production.length) await manager.remove(production);
    await manager.remove(batches);
  }

  // --- Read side (Traceability page) ---

  findRawBatches(rawMaterialId?: string) {
    return this.rawBatchRepo.find({
      where: rawMaterialId ? { rawMaterialId } : {},
      order: { receivedDate: 'DESC', createdAt: 'DESC' },
    });
  }

  findFinishedBatches(finishedGoodId?: string) {
    return this.finishedBatchRepo.find({
      where: finishedGoodId ? { finishedGoodId } : {},
      order: { producedDate: 'DESC', createdAt: 'DESC' },
    });
  }

  // Forward trace: from a raw material batch -> which production runs
  // consumed it -> which finished good batches those runs produced ->
  // which sales orders those finished good batches were sold through.
  async traceForwardFromRawBatch(rawMaterialBatchId: string) {
    const consumptions = await this.productionConsumptionRepo.find({ where: { rawMaterialBatchId } });
    const finishedGoodBatchIds = [...new Set(consumptions.map((c) => c.finishedGoodBatchId))];
    const finishedGoodBatches = finishedGoodBatchIds.length
      ? await this.finishedBatchRepo.findBy({ id: In(finishedGoodBatchIds) })
      : [];
    const salesConsumptions = finishedGoodBatchIds.length
      ? await this.salesConsumptionRepo.findBy({ finishedGoodBatchId: In(finishedGoodBatchIds) })
      : [];
    return { consumptions, finishedGoodBatches, salesConsumptions };
  }

  // Backward trace: from a finished good batch -> which raw material
  // batches (and therefore which suppliers) fed into it.
  async traceBackwardFromFinishedBatch(finishedGoodBatchId: string) {
    const consumptions = await this.productionConsumptionRepo.find({ where: { finishedGoodBatchId } });
    const rawMaterialBatchIds = [...new Set(consumptions.map((c) => c.rawMaterialBatchId))];
    const rawMaterialBatches = rawMaterialBatchIds.length
      ? await this.rawBatchRepo.findBy({ id: In(rawMaterialBatchIds) })
      : [];
    return { consumptions, rawMaterialBatches };
  }

  salesForFinishedBatch(finishedGoodBatchId: string) {
    return this.salesConsumptionRepo.find({ where: { finishedGoodBatchId } });
  }
}
