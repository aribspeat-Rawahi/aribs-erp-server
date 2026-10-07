import { JournalModule } from '../journal/journal.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RawMaterial } from './raw-material.entity';
import { FinishedGood } from './finished-good.entity';
import { RawMaterialBatch } from './raw-material-batch.entity';
import { FinishedGoodBatch } from './finished-good-batch.entity';
import { ProductionBatchConsumption } from '../manufacturing/production-batch-consumption.entity';
import { SalesBatchConsumption } from '../sales/sales-batch-consumption.entity';
import { RawMaterialService } from './raw-material.service';
import { FinishedGoodService } from './finished-good.service';
import { BatchTrackingService } from './batch-tracking.service';
import { RawMaterialController } from './raw-material.controller';
import { FinishedGoodController } from './finished-good.controller';
import { BatchTrackingController } from './batch-tracking.controller';
// Read-only cross-module entities — injected directly into
// RawMaterialService/FinishedGoodService as guard checks before deleting
// a material/product (same repo-injection pattern used throughout this
// codebase to avoid circular module imports; see BomModule/SupplierModule
// etc. never import InventoryModule the other way around).
import { BillOfMaterial } from '../manufacturing/bom.entity';
import { ProductionOrder } from '../manufacturing/production-order.entity';
import { PurchaseOrder } from '../supplier/purchase-order.entity';
import { PurchaseOrderItem } from '../supplier/purchase-order-item.entity';
import { SalesOrder } from '../sales/sales-order.entity';
import { SalesOrderItem } from '../sales/sales-order-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RawMaterial,
      FinishedGood,
      RawMaterialBatch,
      FinishedGoodBatch,
      ProductionBatchConsumption,
      SalesBatchConsumption,
      BillOfMaterial,
      ProductionOrder,
      PurchaseOrder,
      PurchaseOrderItem,
      SalesOrder,
      SalesOrderItem,
    ]),
    JournalModule,
  ],
  controllers: [RawMaterialController, FinishedGoodController, BatchTrackingController],
  providers: [RawMaterialService, FinishedGoodService, BatchTrackingService],
  exports: [RawMaterialService, FinishedGoodService, BatchTrackingService],
})
export class InventoryModule {}
