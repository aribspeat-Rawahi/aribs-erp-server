import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaxRate } from './tax-rate.entity';
import { TaxPayment } from './tax-payment.entity';
import { TaxRateService } from './tax-rate.service';
import { TaxRateController } from './tax-rate.controller';
import { TaxPaymentService } from './tax-payment.service';
import { TaxPaymentController } from './tax-payment.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { JournalModule } from '../journal/journal.module';

// TaxPaymentService talks to BankAccount/BankTransaction directly through
// the shared DataSource (same pattern as FundTransferService) for the
// balance-moving transaction, but does import BankAccountModule for
// BankAccountService.ensureJournalAccountId() (auto-posting's account
// linking) and JournalModule for JournalPostingService — see
// tax-payment.service.ts.
@Module({
  imports: [TypeOrmModule.forFeature([TaxRate, TaxPayment]), ActivityLogModule, BankAccountModule, JournalModule],
  controllers: [TaxRateController, TaxPaymentController],
  providers: [TaxRateService, TaxPaymentService],
  exports: [TaxRateService, TaxPaymentService],
})
export class TaxModule {}
