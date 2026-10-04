import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SalesOrder, SalesOrderStatus } from './sales-order.entity';
import { SalesOrderItem } from './sales-order-item.entity';
import { CreateSalesOrderDto } from './dto/sales-order.dto';
import { FinishedGoodService } from '../inventory/finished-good.service';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { UnitService } from '../units/unit.service';
import { JournalPostingService } from '../journal/journal-posting.service';
import { SalesBatchConsumption } from './sales-batch-consumption.entity';
import { FinishedGoodBatch } from '../inventory/finished-good-batch.entity';
import { BatchSource } from '../inventory/batch-source.enum';
import { BackorderService } from '../stock-alerts/backorder.service';
import { markNotRestorable } from '../deleted-records/deletion-context';

// Auto-posted Chart-of-Accounts codes for the Cost of Goods Sold entry a
// completed sale generates (matches the DEFAULT_ACCOUNTS seed in
// journal/account.service.ts).
const COGS_CODE = '500';
const FG_INVENTORY_CODE = '1210';

interface ActorRef {
  userId?: string;
  email?: string;
}

@Injectable()
export class SalesOrderService {
  constructor(
    @InjectRepository(SalesOrder)
    private orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private itemRepo: Repository<SalesOrderItem>,
    private finishedGoodService: FinishedGoodService,
    private batchTrackingService: BatchTrackingService,
    private journalPosting: JournalPostingService,
    @InjectDataSource()
    private dataSource: DataSource,
    private units: UnitService,
    private backorders: BackorderService,
  ) {}

  findAll() {
    return this.orderRepo.find();
  }

  async findOne(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Sales order not found');
    const items = await this.itemRepo.find({ where: { salesOrderId: id } });
    return { ...order, items };
  }

  // Step 1: create the order — stock is NOT deducted yet, so a draft
  // order (e.g. while quoting/negotiating) doesn't lock up inventory.
  async create(dto: CreateSalesOrderDto) {
    const lines = await this.units.resolveProductLines(dto.items);
    const order = this.orderRepo.create({
      customerId: dto.customerId,
      paymentType: dto.paymentType,
      notes: dto.notes,
      status: SalesOrderStatus.PENDING,
    });
    const savedOrder = await this.orderRepo.save(order);

    const items = lines.map((i) =>
      this.itemRepo.create({ ...i, salesOrderId: savedOrder.id }),
    );
    await this.itemRepo.save(items);

    return { ...savedOrder, items };
  }

  // Step 2: mark the order completed. This is order tracking only: stock
  // leaves (and Cost of Goods Sold is posted) when the INVOICE is created,
  // so completing an order never moves stock - otherwise the same goods
  // would be taken out twice.
  async complete(id: string, _actor: ActorRef = {}) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(SalesOrder, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Sales order not found');
      if (order.status !== SalesOrderStatus.PENDING) {
        throw new BadRequestException(`Order is already ${order.status}`);
      }
      const items = await manager.find(SalesOrderItem, { where: { salesOrderId: id } });
      if (items.length === 0) {
        throw new BadRequestException('This order has no items');
      }
      order.status = SalesOrderStatus.COMPLETED;
      await manager.save(order);
      return { order, items, lowStockWarnings: [] as string[], totalCost: 0 };
    });
  }

  async cancel(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.PENDING) {
      throw new BadRequestException(`Only pending orders can be cancelled (this one is ${order.status})`);
    }
    order.status = SalesOrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }

  // Admin/Accountant only (controller). Pending/cancelled orders never
  // moved stock, so they are simply removed (and can be undone from the
  // Activity Log). Orders completed under the OLD flow (before invoices
  // took over stock) did take stock out and post cost of goods sold: that
  // is put back first - the goods return to the same batches and the
  // 'sales_order' journal entry is removed - so stock and accounts stay
  // right. Such a delete can't be undone (it would have to take the stock
  // out again).
  async remove(id: string) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Sales order not found');
    const items = await this.itemRepo.find({ where: { salesOrderId: id } });
    const productIds: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const consumptions = await manager.find(SalesBatchConsumption, { where: { salesOrderId: id } });
      if (consumptions.length > 0) {
        const backByProduct = new Map<string, number>();
        for (const c of consumptions) {
          const qty = Number(c.quantityConsumed);
          const batch = await manager.findOne(FinishedGoodBatch, { where: { id: c.finishedGoodBatchId }, lock: { mode: 'pessimistic_write' } });
          if (batch) {
            batch.quantityRemaining = Number(batch.quantityRemaining) + qty;
            await manager.save(batch);
          } else {
            await this.batchTrackingService.createFinishedGoodBatch(manager, { finishedGoodId: c.finishedGoodId, quantity: qty, source: BatchSource.MANUAL });
          }
          backByProduct.set(c.finishedGoodId, (backByProduct.get(c.finishedGoodId) || 0) + qty);
        }
        await manager.remove(consumptions);
        for (const [productId, qty] of backByProduct) {
          const good = await manager.findOne(FinishedGood, { where: { id: productId }, lock: { mode: 'pessimistic_write' } });
          if (!good) continue;
          const before = Number(good.quantityInStock);
          good.quantityInStock = Math.round((before + qty) * 1000) / 1000;
          await manager.save(good);
          // if stock was below zero, part of what came back goes to invoices waiting for it
          await this.batchTrackingService.absorbBackorder(manager, productId, before, qty);
          productIds.push(productId);
        }
        markNotRestorable('This order had taken stock out (old flow); deleting it put the stock and cost of goods sold back.');
      }
      if (items.length) await manager.remove(items);
      await manager.remove(order);
    });

    if (productIds.length) {
      try {
        await this.journalPosting.removeForSource('sales_order', id);
      } catch (err) {
        console.error(`Removing auto-posted journal entry failed for sales_order ${id}:`, err);
      }
      await this.backorders.refresh(productIds);
    }
    return { deleted: true, stockReturned: productIds.length > 0 };
  }

  // Used by the Reporting module — count and total value of completed
  // sales orders within a date range.
  async getSummaryInRange(startDate: string, endDate: string) {
    const orders = await this.orderRepo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: SalesOrderStatus.COMPLETED })
      .andWhere('order.createdAt BETWEEN :startDate AND :endDate', {
        startDate: `${startDate} 00:00:00`,
        endDate: `${endDate} 23:59:59`,
      })
      .getMany();
    return { completedOrders: orders.length };
  }
}
