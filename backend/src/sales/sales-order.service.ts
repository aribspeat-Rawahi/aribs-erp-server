import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SalesOrder, SalesOrderStatus } from './sales-order.entity';
import { SalesOrderItem } from './sales-order-item.entity';
import { CreateSalesOrderDto } from './dto/sales-order.dto';
import { FinishedGoodService } from '../inventory/finished-good.service';
import { FinishedGood } from '../inventory/finished-good.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { JournalPostingService } from '../journal/journal-posting.service';

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
    const order = this.orderRepo.create({
      customerId: dto.customerId,
      paymentType: dto.paymentType,
      notes: dto.notes,
      status: SalesOrderStatus.PENDING,
    });
    const savedOrder = await this.orderRepo.save(order);

    const items = dto.items.map((i) =>
      this.itemRepo.create({ ...i, salesOrderId: savedOrder.id }),
    );
    await this.itemRepo.save(items);

    return { ...savedOrder, items };
  }

  // Step 2: complete the sale — this is what actually deducts finished
  // goods stock. Checks all items have enough stock before deducting any
  // (all-or-nothing, same principle as production orders).
  // Wrapped in a single transaction: the SalesOrder row and every
  // FinishedGood row involved are pessimistically locked together, so
  // two concurrent complete() calls on the same order (or on orders that
  // share a product) can't both pass the "already completed"/stock
  // checks and double-deduct.
  async complete(id: string, actor: ActorRef = {}) {
    const result = await this.dataSource.transaction(async (manager) => {
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

      const lowStockWarnings: string[] = [];
      // Cost of Goods Sold for this sale — each item's quantity valued at
      // the product's costPerUnit *before* this sale's own stock deduction
      // (the weighted-average cost the batches being shipped were carried
      // at), summed across all items into a single COGS journal line.
      let totalCost = 0;
      for (const item of items) {
        const product = await manager.findOne(FinishedGood, {
          where: { id: item.finishedGoodId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) throw new NotFoundException('Finished good not found');
        const newQty = Number(product.quantityInStock) - Number(item.quantity);
        if (newQty < 0) {
          throw new BadRequestException(
            `Not enough ${product.name} in stock. Need ${item.quantity}, have ${product.quantityInStock}.`,
          );
        }
        totalCost += Number(item.quantity) * Number(product.costPerUnit);
        // Batch/Lot Traceability — consume finished good batches FIFO
        // BEFORE mutating quantityInStock, linking this sales order to
        // the specific product lot(s) it shipped from.
        await this.batchTrackingService.consumeFinishedGoodFifo(manager, {
          finishedGoodId: product.id,
          quantity: Number(item.quantity),
          salesOrderId: order.id,
        });
        product.quantityInStock = newQty;
        await manager.save(product);
        if (newQty <= Number(product.lowStockThreshold)) lowStockWarnings.push(product.name);
      }

      order.status = SalesOrderStatus.COMPLETED;
      await manager.save(order);

      return { order, items, lowStockWarnings, totalCost };
    });

    // Auto-posts (best-effort) Dr 500 Cost of Goods Sold / Cr 1210
    // Finished Goods Inventory for the shipped items' cost — the
    // inventory-relief entry a sale needs alongside the invoice's own
    // Dr AR/Cr Sales entry, so the Inventory asset account actually goes
    // down when stock leaves and the Trial Balance carries a real COGS
    // figure instead of the Dashboard computing one ad-hoc.
    if (result.totalCost > 0) {
      try {
        const cogsAccountId = await this.journalPosting.findAccountIdByCode(COGS_CODE);
        const fgAccountId = await this.journalPosting.findAccountIdByCode(FG_INVENTORY_CODE);
        await this.journalPosting.postForSource(
          'sales_order',
          id,
          new Date().toISOString().slice(0, 10),
          `Sales Order ${id} — cost of goods sold`,
          [
            { accountId: cogsAccountId, debit: result.totalCost, description: 'Cost of goods sold' },
            { accountId: fgAccountId, credit: result.totalCost, description: 'Finished goods shipped' },
          ],
          actor,
        );
      } catch (err) {
        console.error(`Auto-posting failed for sales_order ${id}:`, err);
      }
    }

    return result;
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
