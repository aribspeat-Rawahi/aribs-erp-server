import { EmailService } from '../common/email.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './quotation.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationEditRequest } from './quotation-edit-request.entity';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { SettingsModule } from '../settings/settings.module';
import { CustomerModule } from '../customer/customer.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quotation, QuotationItem, QuotationEditRequest]),
    InvoiceModule,
    SettingsModule,
    CustomerModule,
    ActivityLogModule,
    ApprovalModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService, EmailService],
  exports: [QuotationService],
})
export class QuotationModule {}
