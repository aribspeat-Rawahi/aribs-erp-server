import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesOrder } from './sales-order.entity';
import { SalesOrderItem } from './sales-order-item.entity';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderController } from './sales-order.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalesOrder, SalesOrderItem]),
    InventoryModule, // gives us FinishedGoodService
    JournalModule,
  ],
  controllers: [SalesOrderController],
  providers: [SalesOrderService],
  exports: [SalesOrderService],
})
export class SalesModule {}
