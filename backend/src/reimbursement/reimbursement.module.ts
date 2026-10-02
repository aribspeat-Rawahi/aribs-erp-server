import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reimbursement } from './reimbursement.entity';
import { ReimbursementService } from './reimbursement.service';
import { ReimbursementController } from './reimbursement.controller';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [TypeOrmModule.forFeature([Reimbursement]), BankAccountModule, ActivityLogModule, JournalModule],
  controllers: [ReimbursementController],
  providers: [ReimbursementService],
  exports: [ReimbursementService],
})
export class ReimbursementModule {}
