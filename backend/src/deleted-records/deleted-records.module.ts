import { JournalModule } from '../journal/journal.module';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeletedRecord } from './deleted-record.entity';
import { DeletedRecordsService } from './deleted-records.service';
import { DeletedRecordsController } from './deleted-records.controller';
import { DeletedRecordsInterceptor } from './deleted-records.interceptor';
import { DeletionCaptureSubscriber } from './deletion-capture.subscriber';
import { EmailService } from '../common/email.service';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeletedRecord]), InvoiceModule, JournalModule],
  controllers: [DeletedRecordsController],
  providers: [
    DeletedRecordsService,
    DeletionCaptureSubscriber,
    EmailService,
    { provide: APP_INTERCEPTOR, useClass: DeletedRecordsInterceptor },
  ],
})
export class DeletedRecordsModule {}
