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
