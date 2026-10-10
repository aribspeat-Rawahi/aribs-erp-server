import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequisition, PurchaseRequisitionItem } from './purchase-requisition.entity';
import { Rfq, RfqItem, RfqQuote } from './rfq.entity';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { RfqService } from './rfq.service';
import { PurchaseRequisitionController, RfqController } from './procurement.controller';
import { SupplierModule } from '../supplier/supplier.module';
import { DocumentApprovalModule } from '../document-approval/document-approval.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseRequisition, PurchaseRequisitionItem, Rfq, RfqItem, RfqQuote]),
    SupplierModule,
    DocumentApprovalModule,
    ActivityLogModule,
    SettingsModule,
  ],
  controllers: [PurchaseRequisitionController, RfqController],
  providers: [PurchaseRequisitionService, RfqService],
})
export class ProcurementModule {}
