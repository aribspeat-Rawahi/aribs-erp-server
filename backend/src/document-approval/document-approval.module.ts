import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRule, DocumentApproval } from './document-approval.entity';
import { DocumentApprovalService } from './document-approval.service';
import { ApprovalRuleController, DocumentApprovalController } from './document-approval.controller';
import { EmailService } from '../common/email.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRule, DocumentApproval]), ActivityLogModule],
  controllers: [DocumentApprovalController, ApprovalRuleController],
  providers: [DocumentApprovalService, EmailService],
  exports: [DocumentApprovalService],
})
export class DocumentApprovalModule {}
