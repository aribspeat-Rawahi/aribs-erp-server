import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillOfMaterial } from './bom.entity';
import { ProductionOrder } from './production-order.entity';
import { BomService } from './bom.service';
import { ProductionOrderService } from './production-order.service';
import { BomController } from './bom.controller';
import { ProductionOrderController } from './production-order.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillOfMaterial, ProductionOrder]),
    InventoryModule, // gives us RawMaterialService + FinishedGoodService
    JournalModule,
  ],
  controllers: [BomController, ProductionOrderController],
  providers: [BomService, ProductionOrderService],
  exports: [BomService, ProductionOrderService],
})
export class ManufacturingModule {}
