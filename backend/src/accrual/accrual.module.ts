import { Module } from '@nestjs/common';
import { AccrualPostingService } from './accrual-posting.service';
import { AccrualController } from './accrual.controller';
import { HrModule } from '../hr/hr.module';
import { SettingsModule } from '../settings/settings.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [HrModule, SettingsModule, JournalModule],
  controllers: [AccrualController],
  providers: [AccrualPostingService],
  exports: [AccrualPostingService],
})
export class AccrualModule {}
