import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { FinishedGood } from './finished-good.entity';
import { CreateFinishedGoodDto, ScanStockDto } from './dto/finished-good.dto';
import { generateQrDataUrl } from '../common/barcode.util';
import { BatchTrackingService } from './batch-tracking.service';
import { BatchSource } from './batch-source.enum';
import { BillOfMaterial } from '../manufacturing/bom.entity';
import { ProductionOrder, ProductionOrderStatus } from '../manufacturing/production-order.entity';
import { SalesOrder, SalesOrderStatus } from '../sales/sales-order.entity';
import { SalesOrderItem } from '../sales/sales-order-item.entity';
import { BackorderService } from '../stock-alerts/backorder.service';
import { assertQuantityForUnit, isDecimalUnit, unitLabel } from '../units/units';

@Injectable()
export class FinishedGoodService {
  constructor(
    @InjectRepository(FinishedGood)
    private repo: Repository<FinishedGood>,
    @InjectRepository(BillOfMaterial)
    private bomRepo: Repository<BillOfMaterial>,
    @InjectRepository(ProductionOrder)
    private productionOrderRepo: Repository<ProductionOrder>,
    @InjectRepository(SalesOrder)
    private salesOrderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private salesOrderItemRepo: Repository<SalesOrderItem>,
    @InjectDataSource()
    private dataSource: DataSource,
    private batchTrackingService: BatchTrackingService,
    private backorders: BackorderService,
  ) {}

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Finished good not found');
    return item;
  }

  async findByBarcode(barcode: string) {
    const item = await this.repo.findOne({ where: { barcode } });
    if (!item) throw new NotFoundException('No product matches this barcode');
    return item;
  }

  // Uses the barcode you provide (official GS1 code already on the bag,
  // or a manually assigned one). We also generate a QR image of it,
  // in case you want a scannable label/sticker as a backup.
  async create(dto: CreateFinishedGoodDto) {
    if (dto.quantityInStock !== undefined) {
      assertQuantityForUnit(dto.quantityInStock, dto.unit, dto.name, { allowZero: true });
    }
    const item = this.repo.create(dto);
    const saved = await this.repo.save(item);
    const qrImage = await generateQrDataUrl(saved.barcode);
    return { ...saved, qrImage };
  }

  // quantityInStock is deliberately never accepted here — changing stock
  // without a batch record or a journal entry would silently desync
  // Inventory Reports and the Chart-of-Accounts Inventory balance. Use
  // stockIn() (barcode/manual scan) or a Production Order / Sales Order
  // instead, both of which create a proper trail.
  async update(id: string, dto: Partial<CreateFinishedGoodDto>) {
    const item = await this.findOne(id);
    const { quantityInStock, ...safeDto } = dto;
    // Switching to Pcs/Bags is only possible while the stock is a whole number.
    if (safeDto.unit && !isDecimalUnit(safeDto.unit) && !Number.isInteger(Number(item.quantityInStock))) {
      throw new BadRequestException(
        `${item.name} has ${Number(item.quantityInStock)} in stock - ${unitLabel(safeDto.unit)} needs a whole number. Adjust the stock first.`,
      );
    }
    Object.assign(item, safeDto);
    return this.repo.save(item);
  }

  // Stock IN — barcode/manual scan (a production order's own stock-in is
  // handled directly by ProductionOrderService.complete(), which also
  // creates the proper "production_order" sourced batch instead of this
  // generic "manual" one).
  // Batch tracking: creates a new "manual" FinishedGoodBatch for the
  // scanned-in quantity, so it can still be traced/sold like any other lot.
  async stockIn(dto: ScanStockDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(FinishedGood, {
        where: { barcode: dto.barcode },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('No product matches this barcode');
      assertQuantityForUnit(dto.quantity, item.unit, item.name);
      const before = Number(item.quantityInStock);
      item.quantityInStock = before + Number(dto.quantity);
      const saved = await manager.save(item);
      await this.batchTrackingService.createFinishedGoodBatch(manager, {
        finishedGoodId: item.id,
        quantity: Number(dto.quantity),
        source: BatchSource.MANUAL,
      });
      // goods already invoiced while stock was short leave the new batch at once
      await this.batchTrackingService.absorbBackorder(manager, item.id, before, Number(dto.quantity));
      return saved;
    });
    // invoices waiting for this product may now be ready (sends the reminder)
    await this.backorders.refresh([result.id]);
    return result;
  }

  // Stock OUT — called at point of sale (scan or manual).
  async stockOut(dto: ScanStockDto) {
    const item = await this.findByBarcode(dto.barcode);
    return this.deductStock(item.id, dto.quantity);
  }

  // Same as stockOut, but used internally by Sales Orders which
  // reference the product by id rather than barcode.
  async stockOutById(id: string, quantity: number) {
    return this.deductStock(id, quantity);
  }

  // Wrapped in a transaction with a pessimistic write lock so concurrent
  // deductions against the same row serialize instead of racing on a
  // stale read-then-write. Also consumes FinishedGoodBatch rows FIFO
  // (before the quantityInStock write, so an opening-balance snapshot if
  // needed reflects pre-deduction stock).
  private async deductStock(id: string, quantity: number) {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(FinishedGood, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Finished good not found');
      assertQuantityForUnit(quantity, item.unit, item.name);
      const newQty = Number(item.quantityInStock) - Number(quantity);
      if (newQty < 0) {
        throw new BadRequestException(
          `Insufficient stock for ${item.name}. Available: ${item.quantityInStock}`,
        );
      }
      await this.batchTrackingService.consumeFinishedGoodFifo(manager, {
        finishedGoodId: id,
        quantity: Number(quantity),
      });
      item.quantityInStock = newQty;
      const saved = await manager.save(item);
      return { item: saved, isLowStock: newQty <= Number(item.lowStockThreshold) };
    });
  }

  async findLowStock() {
    const all = await this.repo.find();
    return all.filter(
      (p) => Number(p.quantityInStock) <= Number(p.lowStockThreshold),
    );
  }

  // Deleting a finished good is blocked whenever it could silently break
  // something else in the app:
  // - still has stock (adjust to zero first, so the value isn't just discarded)
  // - a planned Production Order would produce it — completing it later
  //   would fail with a confusing "finished good not found"
  // - a pending Sales Order includes it — completing that sale would fail
  //   the same way
  // Its own recipe (BOM lines) is deleted along with it, since a recipe
  // for a product that no longer exists is meaningless. Historical
  // records (old sales orders, production runs, batch trace rows) are
  // NOT blocked on — same "Unknown product" trade-off as raw materials.
  async remove(id: string) {
    const item = await this.findOne(id);

    if (Number(item.quantityInStock) > 0.001) {
      throw new BadRequestException(
        `Cannot delete ${item.name} — it still has ${item.quantityInStock} ${item.unit} in stock. Adjust stock to zero first.`,
      );
    }

    const plannedCount = await this.productionOrderRepo.count({
      where: { finishedGoodId: id, status: ProductionOrderStatus.PLANNED },
    });
    if (plannedCount > 0) {
      throw new BadRequestException(
        `Cannot delete ${item.name} — it has ${plannedCount} planned production order(s). Complete or cancel them first.`,
      );
    }

    const orderItems = await this.salesOrderItemRepo.find({ where: { finishedGoodId: id } });
    if (orderItems.length > 0) {
      const orderIds = [...new Set(orderItems.map((i) => i.salesOrderId))];
      const pendingCount = await this.salesOrderRepo.count({
        where: { id: In(orderIds), status: SalesOrderStatus.PENDING },
      });
      if (pendingCount > 0) {
        throw new BadRequestException(
          `Cannot delete ${item.name} — it's on a pending sales order. Complete or cancel that order first.`,
        );
      }
    }

    const bomLines = await this.bomRepo.find({ where: { finishedGoodId: id } });
    if (bomLines.length > 0) await this.bomRepo.remove(bomLines);

    await this.repo.remove(item);
    return { deleted: true };
  }
}
