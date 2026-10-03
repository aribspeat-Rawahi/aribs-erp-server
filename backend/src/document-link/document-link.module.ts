import { Global, Module } from '@nestjs/common';
import { DocumentLinkService } from './document-link.service';

// Global so Invoice/Quotation/DeliveryNote services can inject it without
// changing their own module imports.
@Global()
@Module({
  providers: [DocumentLinkService],
  exports: [DocumentLinkService],
})
export class DocumentLinkModule {}
