import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { QuotationModule } from '../quotation/quotation.module';
import { DeliveryNoteModule } from '../delivery-note/delivery-note.module';
import { PublicDocumentController } from './public-document.controller';

@Module({
  imports: [InvoiceModule, QuotationModule, DeliveryNoteModule],
  controllers: [PublicDocumentController],
})
export class PublicDocumentModule {}
