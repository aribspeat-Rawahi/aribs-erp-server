import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './invoice.entity';
import { InvoiceItem } from './invoice-item.entity';
import { InvoicePayment } from './invoice-payment.entity';
import { SalesReturn } from './sales-return.entity';
import { SalesReturnItem } from './sales-return-item.entity';
import { InvoiceService } from './invoice.service';
import { InvoicePaymentService } from './invoice-payment.service';
import { SalesReturnService } from './sales-return.service';
import { PaymentReminderService } from './payment-reminder.service';
import { InvoiceController } from './invoice.controller';
import { InvoicePaymentController } from './invoice-payment.controller';
import { SalesReturnController } from './sales-return.controller';
import { CustomerModule } from '../customer/customer.module';
import { EmailService } from '../common/email.service';
import { SettingsModule } from '../settings/settings.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DeliveryNoteModule } from '../delivery-note/delivery-note.module';
import { ApprovalModule } from '../approval/approval.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { JournalModule } from '../journal/journal.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, InvoicePayment, SalesReturn, SalesReturnItem]),
    CustomerModule,
    SettingsModule,
    ActivityLogModule,
    DeliveryNoteModule,
    ApprovalModule,
    BankAccountModule,
    JournalModule,
    InventoryModule, // gives us FinishedGood + BatchTrackingService for SalesReturnService
  ],
  controllers: [InvoiceController, InvoicePaymentController, SalesReturnController],
  providers: [InvoiceService, InvoicePaymentService, SalesReturnService, PaymentReminderService, EmailService],
  exports: [InvoiceService, InvoicePaymentService, SalesReturnService, PaymentReminderService],
})
export class InvoiceModule {}
