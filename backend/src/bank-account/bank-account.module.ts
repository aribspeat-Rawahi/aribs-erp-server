import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankAccount } from './bank-account.entity';
import { BankTransaction } from './bank-transaction.entity';
import { FundTransfer } from './fund-transfer.entity';
import { BankAccountService } from './bank-account.service';
import { BankAccountController } from './bank-account.controller';
import { FundTransferService } from './fund-transfer.service';
import { FundTransferController } from './fund-transfer.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [TypeOrmModule.forFeature([BankAccount, BankTransaction, FundTransfer]), ActivityLogModule, JournalModule],
  controllers: [BankAccountController, FundTransferController],
  providers: [BankAccountService, FundTransferService],
  exports: [BankAccountService, FundTransferService],
})
export class BankAccountModule {}
