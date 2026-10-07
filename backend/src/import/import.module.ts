import { JournalModule } from '../journal/journal.module';
import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [InventoryModule, ActivityLogModule, JournalModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
