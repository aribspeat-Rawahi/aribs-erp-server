import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringInvoice } from './recurring-invoice.entity';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { CustomerModule } from '../customer/customer.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([RecurringInvoice]), CustomerModule, InvoiceModule, ActivityLogModule],
  controllers: [RecurringInvoiceController],
  providers: [RecurringInvoiceService],
  exports: [RecurringInvoiceService],
})
export class RecurringInvoiceModule {}
