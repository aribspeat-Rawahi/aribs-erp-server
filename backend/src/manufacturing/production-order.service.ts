import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductionOrder, ProductionOrderStatus } from './production-order.entity';
import { CreateProductionOrderDto } from './dto/manufacturing.dto';
import { BomService } from './bom.service';
import { RawMaterialService } from '../inventory/raw-material.service';
import { FinishedGoodService } from '../inventory/finished-good.service';
import { RawMaterial } from '../inventory/raw-material.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { JournalPostingService } from '../journal/journal-posting.service';
import { assertQuantityForUnit } from '../units/units';
import { BackorderService } from '../stock-alerts/backorder.service';
import { omanToday } from '../common/oman-date';

// Auto-posted Chart-of-Accounts codes for a completed production run —
// transfers material cost from Raw Materials into Finished Goods
// (matches the DEFAULT_ACCOUNTS seed in journal/account.service.ts).
const FG_INVENTORY_CODE = '1210';
const RM_INVENTORY_CODE = '1200';

interface ActorRef {
  userId?: string;
  email?: string;
}

@Injectable()
export class ProductionOrderService {
  constructor(
    @InjectRepository(ProductionOrder)
    private repo: Repository<ProductionOrder>,
    private bomService: BomService,
    private rawMaterialService: RawMaterialService,
    private finishedGoodService: FinishedGoodService,
    private batchTrackingService: BatchTrackingService,
    private journalPosting: JournalPostingService,
    @InjectDataSource()
    private dataSource: DataSource,
    private backorders: BackorderService,
  ) {}

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Production order not found');
    return item;
  }

  // Step 1: plan a production run. Does NOT touch stock yet — that only
  // happens on complete(), so planning something you can't finish yet
  // doesn't lock up material.
  async create(dto: CreateProductionOrderDto) {
    const product = await this.finishedGoodService.findOne(dto.finishedGoodId);
    assertQuantityForUnit(dto.quantityToProduce, product.unit, product.name);
    const order = this.repo.create({
      ...dto,
      status: ProductionOrderStatus.PLANNED,
    });
    return this.repo.save(order);
  }

  // Step 2: complete the run.
  // - Checks the BOM (recipe) for this finished good
  // - Consumes each raw material (quantityPerUnit * quantityToProduce)
  // - Adds the produced quantity to finished goods stock
  // If any raw material is short, the whole thing is rejected up front —
  // nothing is partially consumed.
  // Wrapped in a single transaction: the ProductionOrder row and every
  // RawMaterial/FinishedGood row touched are pessimistically locked
  // together, so two concurrent complete() calls can't both pass the
  // "already completed"/stock checks and double-consume or double-produce.
  async complete(id: string, actor: ActorRef = {}) {
    const bomLines = await this.bomService.findByFinishedGood(
      (await this.findOne(id)).finishedGoodId,
    );

    // closed books: a production run is dated today
    await this.journalPosting.assertDateOpen(omanToday(), 'This production run');
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(ProductionOrder, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Production order not found');
      if (order.status !== ProductionOrderStatus.PLANNED) {
        throw new BadRequestException(`Order is already ${order.status}`);
      }

      if (bomLines.length === 0) {
        throw new BadRequestException(
          'No BOM (recipe) is defined for this product yet — add raw materials first.',
        );
      }

      // Pre-check all materials have enough stock before consuming any of them.
      const lockedMaterials = new Map<string, RawMaterial>();
      for (const line of bomLines) {
        const material = await manager.findOne(RawMaterial, {
          where: { id: line.rawMaterialId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!material) throw new NotFoundException('Raw material not found');
        const needed = Number(line.quantityPerUnit) * Number(order.quantityToProduce);
        if (Number(material.quantityInStock) < needed) {
          throw new BadRequestException(
            `Not enough ${material.name} in stock. Need ${needed} ${material.unit}, have ${material.quantityInStock}.`,
          );
        }
        lockedMaterials.set(line.rawMaterialId, material);
      }

      // Batch/Lot Traceability — create the finished-good lot this run
      // produces FIRST, so each raw material batch consumed below can be
      // linked to it (ProductionBatchConsumption.finishedGoodBatchId).
      const finishedGoodBatch = await this.batchTrackingService.createFinishedGoodBatch(manager, {
        finishedGoodId: order.finishedGoodId,
        quantity: Number(order.quantityToProduce),
        source: BatchSource.PRODUCTION_ORDER,
        productionOrderId: order.id,
      });

      // Now actually consume.
      const lowStockWarnings: string[] = [];
      for (const line of bomLines) {
        const material = lockedMaterials.get(line.rawMaterialId)!;
        const needed = Number(line.quantityPerUnit) * Number(order.quantityToProduce);
        // Consume raw material batches FIFO BEFORE mutating
        // quantityInStock, so an opening-balance snapshot (if this
        // material has no batch history yet) captures pre-consumption stock.
        await this.batchTrackingService.consumeRawMaterialFifo(manager, {
          rawMaterialId: material.id,
          quantity: needed,
          productionOrderId: order.id,
          finishedGoodBatchId: finishedGoodBatch.id,
        });
        const newQty = Number(material.quantityInStock) - needed;
        material.quantityInStock = newQty;
        await manager.save(material);
        if (newQty <= Number(material.lowStockThreshold)) lowStockWarnings.push(material.name);
      }

      const finishedGood = await manager.findOne(FinishedGood, {
        where: { id: order.finishedGoodId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!finishedGood) throw new NotFoundException('Finished good not found');

      // This batch's unit cost, from the BOM's raw material costs (per
      // unit produced — independent of order quantity, since
      // quantityPerUnit is already "per unit of finished good"). Blended
      // with whatever's already in stock as a weighted (moving) average,
      // so costPerUnit — and the Dashboard's COGS/Gross Profit figures
      // that read it — stays a realistic running cost rather than only
      // ever reflecting the very first batch ever produced.
      const batchUnitCost = bomLines.reduce(
        (sum, line) => sum + Number(line.quantityPerUnit) * Number(lockedMaterials.get(line.rawMaterialId)!.costPerUnit),
        0,
      );
      const existingQty = Number(finishedGood.quantityInStock);
      const producedQty = Number(order.quantityToProduce);
      // Stock below zero = goods already invoiced but not made yet; they
      // carry no value, so only real (positive) stock is averaged in.
      const valuedQty = Math.max(existingQty, 0);
      const existingValue = valuedQty * Number(finishedGood.costPerUnit);
      const newValue = producedQty * batchUnitCost;
      finishedGood.costPerUnit =
        valuedQty + producedQty > 0 ? (existingValue + newValue) / (valuedQty + producedQty) : batchUnitCost;

      finishedGood.quantityInStock = existingQty + producedQty;
      await manager.save(finishedGood);
      // the part that fills invoices already waiting for it leaves the new batch at once
      await this.batchTrackingService.absorbBackorder(manager, finishedGood.id, existingQty, producedQty);

      order.status = ProductionOrderStatus.COMPLETED;
      order.completedAt = new Date();
      await manager.save(order);

      // Dr 1210 Finished Goods Inventory / Cr 1200 Raw Materials Inventory
      // for the material cost moved into the produced batch - otherwise the
      // Inventory accounts never reflect material consumed on the shop
      // floor. Posted in the SAME transaction: if the journal can't be
      // posted, the production run (stock in/out, cost) is rolled back too.
      if (newValue > 0) {
        const fgAccountId = await this.journalPosting.findAccountIdByCode(FG_INVENTORY_CODE);
        const rmAccountId = await this.journalPosting.findAccountIdByCode(RM_INVENTORY_CODE);
        await this.journalPosting.postForSource(
          'production_order',
          id,
          omanToday(),
          `Production Order ${finishedGoodBatch.batchNumber} — material transfer`,
          [
            { accountId: fgAccountId, debit: newValue, description: 'Finished goods produced' },
            { accountId: rmAccountId, credit: newValue, description: 'Raw materials consumed' },
          ],
          actor,
          undefined,
          manager,
        );
      }

      return {
        order,
        lowStockWarnings,
        finishedGoodBatchNumber: finishedGoodBatch.batchNumber,
        materialCost: newValue,
      };
    });

    await this.backorders.refresh([result.order.finishedGoodId]);
    return result;
  }

  async cancel(id: string) {
    const order = await this.findOne(id);
    if (order.status !== ProductionOrderStatus.PLANNED) {
      throw new BadRequestException(`Only planned orders can be cancelled (this one is ${order.status})`);
    }
    order.status = ProductionOrderStatus.CANCELLED;
    return this.repo.save(order);
  }

  // Editing is only allowed while still PLANNED — once complete() has run,
  // stock/batches have already been adjusted from the original quantity,
  // so changing it afterwards would silently desynchronize inventory.
  async update(id: string, dto: Partial<CreateProductionOrderDto>) {
    const order = await this.findOne(id);
    if (order.status !== ProductionOrderStatus.PLANNED) {
      throw new BadRequestException(`Only planned orders can be edited (this one is ${order.status})`);
    }
    if (dto.quantityToProduce !== undefined || dto.finishedGoodId !== undefined) {
      const product = await this.finishedGoodService.findOne(dto.finishedGoodId || order.finishedGoodId);
      assertQuantityForUnit(dto.quantityToProduce ?? order.quantityToProduce, product.unit, product.name);
    }
    Object.assign(order, dto);
    return this.repo.save(order);
  }

  // Same "only while still planned" restriction — a completed/cancelled
  // order is kept for the audit trail rather than deleted.
  async remove(id: string) {
    const order = await this.findOne(id);
    if (order.status !== ProductionOrderStatus.PLANNED) {
      throw new BadRequestException(
        `Only planned orders can be deleted (this one is ${order.status}) — completed/cancelled orders are kept for the audit trail.`,
      );
    }
    await this.repo.remove(order);
    return { deleted: true };
  }

  // Used by the Reporting module — how many production orders completed,
  // and total quantity produced, within a date range.
  async getSummaryInRange(startDate: string, endDate: string) {
    const orders = await this.repo
      .createQueryBuilder('po')
      .where('po.status = :status', { status: ProductionOrderStatus.COMPLETED })
      .andWhere('po.completedAt BETWEEN :startDate AND :endDate', {
        startDate: `${startDate} 00:00:00`,
        endDate: `${endDate} 23:59:59`,
      })
      .getMany();
    const totalQuantity = orders.reduce((sum, o) => sum + Number(o.quantityToProduce), 0);
    return { completedOrders: orders.length, totalQuantityProduced: totalQuantity };
  }
}
