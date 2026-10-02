import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { CustomerModule } from '../customer/customer.module';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalModule } from '../journal/journal.module';
// Cross-module entity, injected directly (same read-only pattern
// InventoryModule/CustomerModule already use) to avoid a circular
// dependency with ManufacturingModule — only used here to sum raw
// material consumption by date for the Inventory Turnover report.
import { ProductionBatchConsumption } from '../manufacturing/production-batch-consumption.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionBatchConsumption]),
    InvoiceModule, // InvoiceService — product/customer sales breakdowns, aging rows
    CustomerModule, // CustomerService — customer names
    InventoryModule, // RawMaterialService + FinishedGoodService — stock, cost
    JournalModule, // JournalEntryService — monthly Income Statement for Revenue Trend
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
