import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { CustomerModule } from '../customer/customer.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { ApprovalModule } from '../approval/approval.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';
import { SupplierModule } from '../supplier/supplier.module';
import { JournalModule } from '../journal/journal.module';
import { RecurringInvoice } from '../recurring-invoice/recurring-invoice.entity';

@Module({
  imports: [
    InventoryModule,
    SalesModule,
    ManufacturingModule,
    AccountingModule,
    InvoiceModule,
    CustomerModule,
    BankAccountModule,
    // CRM Step 9 — Combined Dashboard Alerts. ApprovalModule only depends
    // on repos (see approval.module.ts), so importing it here creates no
    // cycle. RecurringInvoice is read directly via its repo (same
    // established convention) instead of importing RecurringInvoiceModule.
    ApprovalModule,
    // Reimbursement's own pending-count (alerts) and paid-daily-totals
    // (trend chart) — ReimbursementService isn't re-exported by
    // AccountingModule, so it's imported here directly too.
    ReimbursementModule,
    // Reports Hub — Purchase VAT (PurchaseOrderService) and Income
    // Statement/Balance Sheet (JournalEntryService). Neither module
    // imports ReportingModule, so no cycle.
    SupplierModule,
    JournalModule,
    TypeOrmModule.forFeature([RecurringInvoice]),
  ],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
