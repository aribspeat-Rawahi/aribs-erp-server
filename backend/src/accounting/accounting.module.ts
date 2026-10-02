import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from './expense.entity';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AccountingSummaryService } from './accounting-summary.service';
import { AccountingSummaryController } from './accounting-summary.controller';
import { InvoiceModule } from '../invoice/invoice.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [TypeOrmModule.forFeature([Expense]), InvoiceModule, ReimbursementModule, BankAccountModule, JournalModule],
  controllers: [ExpenseController, AccountingSummaryController],
  providers: [ExpenseService, AccountingSummaryService],
  exports: [ExpenseService, AccountingSummaryService],
})
export class AccountingModule {}
