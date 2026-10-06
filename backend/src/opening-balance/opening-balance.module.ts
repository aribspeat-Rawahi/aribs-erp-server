import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpeningBalanceLine } from './opening-balance-line.entity';
import { OpeningBalanceService } from './opening-balance.service';
import { OpeningBalanceController } from './opening-balance.controller';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalModule } from '../journal/journal.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([OpeningBalanceLine]), BankAccountModule, InventoryModule, JournalModule, ActivityLogModule],
  controllers: [OpeningBalanceController],
  providers: [OpeningBalanceService],
})
export class OpeningBalanceModule {}
