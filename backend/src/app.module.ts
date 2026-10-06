import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SlowQueryLogger, slowQueryThresholdMs } from './monitoring/slow-query-logger';
import { ThrottlerModule } from '@nestjs/throttler';
import { InventoryModule } from './inventory/inventory.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { SupplierModule } from './supplier/supplier.module';
import { CustomerModule } from './customer/customer.module';
import { SalesModule } from './sales/sales.module';
import { InvoiceModule } from './invoice/invoice.module';
import { QuotationModule } from './quotation/quotation.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { HrModule } from './hr/hr.module';
import { AccountingModule } from './accounting/accounting.module';
import { ReportingModule } from './reporting/reporting.module';
import { DeliveryNoteModule } from './delivery-note/delivery-note.module';
import { BankAccountModule } from './bank-account/bank-account.module';
import { ApprovalModule } from './approval/approval.module';
import { RecurringInvoiceModule } from './recurring-invoice/recurring-invoice.module';
import { ReimbursementModule } from './reimbursement/reimbursement.module';
import { OpeningBalanceModule } from './opening-balance/opening-balance.module';
import { JournalModule } from './journal/journal.module';
import { TaxModule } from './tax/tax.module';
import { FixedAssetModule } from './fixed-asset/fixed-asset.module';
import { AccrualModule } from './accrual/accrual.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PaymentModule } from './payment/payment.module';
import { BackupModule } from './backup/backup.module';
import { DataSource } from 'typeorm';
import { databaseOptions, detectDatabaseType, keepUuidAsVarchar } from './data-source';
import { SchemaCheckModule } from './schema-check/schema-check.module';
import { DocumentLinkModule } from './document-link/document-link.module';
import { PublicDocumentModule } from './public-document/public-document.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { UnitsModule } from './units/units.module';
import { StockAlertsModule } from './stock-alerts/stock-alerts.module';
import { DeletedRecordsModule } from './deleted-records/deleted-records.module';
import { ImportModule } from './import/import.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Basic rate limiting — 10 requests per 60s per IP by default.
    // Registered here so ThrottlerGuard is available to inject; applied
    // per-route with @UseGuards(ThrottlerGuard) on AuthController's
    // login/register (see auth.controller.ts).
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    // Powers PaymentReminderService's daily @Cron job (Step 5 — Payment
    // Reminder Automation). No config needed here; each job declares its
    // own schedule.
    ScheduleModule.forRoot(),
    // Database: settings shared with the migration CLI (see data-source.ts).
    // synchronize is permanently OFF - schema changes only happen through
    // migration files in src/migrations, which run automatically on startup.
    // ConfigModule loads .env (local dev) into process.env before this runs.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async () => ({
        ...databaseOptions(process.env, await detectDatabaseType()),
        // Entities are registered by each module (forFeature).
        entities: undefined,
        autoLoadEntities: true,
        migrationsRun: true,
        // Slow queries are logged + emailed (monitoring/slow-query-logger.ts).
        maxQueryExecutionTime: slowQueryThresholdMs(),
        logger: new SlowQueryLogger(),
      }),
      dataSourceFactory: async (options) => {
        if (!options) throw new Error('Missing database options');
        return keepUuidAsVarchar(new DataSource(options)).initialize();
      },
    }),
    InventoryModule,
    ManufacturingModule,
    SupplierModule,
    CustomerModule,
    SalesModule,
    InvoiceModule,
    QuotationModule,
    AuthModule,
    SettingsModule,
    ActivityLogModule,
    HrModule,
    AccountingModule,
    ReportingModule,
    DeliveryNoteModule,
    BankAccountModule,
    ApprovalModule,
    RecurringInvoiceModule,
    ReimbursementModule,
    OpeningBalanceModule,
    JournalModule,
    TaxModule,
    FixedAssetModule,
    AccrualModule,
    AnalyticsModule,
    PaymentModule,
    BackupModule,
    DocumentLinkModule,
    PublicDocumentModule,
    MonitoringModule,
    UnitsModule,
    StockAlertsModule,
    DeletedRecordsModule,
    ImportModule,
    SchemaCheckModule,
  ],
})
export class AppModule {}
