import { JournalModule } from '../journal/journal.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { JournalImportController } from './journal-import.controller';
import { JournalImportService } from './journal-import.service';
import { JournalImportBatch, JournalImportMapping } from './journal-import.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([JournalImportBatch, JournalImportMapping]), InventoryModule, ActivityLogModule, JournalModule],
  controllers: [ImportController, JournalImportController],
  providers: [ImportService, JournalImportService],
})
export class ImportModule {}
