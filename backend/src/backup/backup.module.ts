import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { OffsiteBackupService } from './offsite-backup.service';
import { EmailService } from '../common/email.service';

@Module({
  imports: [ActivityLogModule],
  controllers: [BackupController],
  providers: [BackupService, OffsiteBackupService, EmailService],
})
export class BackupModule {}
