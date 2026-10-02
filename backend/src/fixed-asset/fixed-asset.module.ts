import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FixedAsset } from './fixed-asset.entity';
import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetController } from './fixed-asset.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [TypeOrmModule.forFeature([FixedAsset]), ActivityLogModule, BankAccountModule, JournalModule],
  controllers: [FixedAssetController],
  providers: [FixedAssetService],
  exports: [FixedAssetService],
})
export class FixedAssetModule {}
