import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VatPeriod } from './vat-period.entity';
import { VatPeriodService } from './vat-period.service';
import { VatPeriodController } from './vat-period.controller';
import { ReportingModule } from '../reporting/reporting.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [TypeOrmModule.forFeature([VatPeriod]), ReportingModule, ActivityLogModule],
  controllers: [VatPeriodController],
  providers: [VatPeriodService, EmailService],
})
export class VatPeriodModule {}
