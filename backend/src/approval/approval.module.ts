import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from './approval-request.entity';
import { QuotationEditRequest } from '../quotation/quotation-edit-request.entity';
import { Quotation } from '../quotation/quotation.entity';
import { Customer } from '../customer/customer.entity';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { EmailService } from '../common/email.service';

// Deliberately depends only on TypeORM entities (not QuotationModule/
// CustomerModule themselves) so InvoiceModule and QuotationModule can
// both import this module one-directionally without a circular
// dependency — same repo-injection pattern used throughout this codebase.
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest, QuotationEditRequest, Quotation, Customer])],
  controllers: [ApprovalController],
  providers: [ApprovalService, EmailService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
