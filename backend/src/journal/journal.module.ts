import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './account.entity';
import { JournalEntry } from './journal-entry.entity';
import { JournalEntryLine } from './journal-entry-line.entity';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { JournalEntryService } from './journal-entry.service';
import { JournalEntryController } from './journal-entry.controller';
import { JournalPostingService } from './journal-posting.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, JournalEntry, JournalEntryLine]),
    ActivityLogModule,
  ],
  controllers: [AccountController, JournalEntryController],
  providers: [AccountService, JournalEntryService, JournalPostingService],
  exports: [AccountService, JournalEntryService, JournalPostingService],
})
export class JournalModule {}
