import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomerBankAccount } from './customer-bank-account.entity';
import { CustomerDocument } from './customer-document.entity';
import { CustomerInteraction } from './customer-interaction.entity';
import { CustomerService } from './customer.service';
import { CustomerBankAccountService } from './customer-bank-account.service';
import { CustomerDocumentService } from './customer-document.service';
import { CustomerInteractionService } from './customer-interaction.service';
import { CustomerController } from './customer.controller';
import { CustomerBankAccountController } from './customer-bank-account.controller';
import { CustomerDocumentController } from './customer-document.controller';
import { CustomerInteractionController } from './customer-interaction.controller';
import { EmailService } from '../common/email.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { Invoice } from '../invoice/invoice.entity';
import { Quotation } from '../quotation/quotation.entity';
import { DeliveryNote } from '../delivery-note/delivery-note.entity';

@Module({
  // Invoice/Quotation/DeliveryNote entities are registered here (not
  // their modules) purely to read customer history without creating a
  // circular module dependency (those modules already import CustomerModule).
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerBankAccount, CustomerDocument, CustomerInteraction, Invoice, Quotation, DeliveryNote]),
    ActivityLogModule,
  ],
  controllers: [CustomerController, CustomerBankAccountController, CustomerDocumentController, CustomerInteractionController],
  providers: [CustomerService, CustomerBankAccountService, CustomerDocumentService, CustomerInteractionService, EmailService],
  exports: [CustomerService],
})
export class CustomerModule {}
