import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ReportingService } from './reporting.service';
import { BooksCheckService } from './books-check.service';
import { JournalGapsService } from './journal-gaps.service';
import { RepostJournalDto } from './dto/repost-journal.dto';
import { ModuleAccess } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { omanToday } from '../common/oman-date';

interface AuthedRequest extends Request {
  user?: { userId?: string; email?: string };
}

@ModuleAccess('dashboard', { readAlso: ['accounting'] })
@Controller('reports')
export class ReportingController {
  constructor(
    private service: ReportingService,
    private booksCheck: BooksCheckService,
    private journalGaps: JournalGapsService,
  ) {}

  @Get('low-stock')
  getLowStockReport() {
    return this.service.getLowStockReport();
  }

  // e.g. GET /reports/summary?startDate=2026-09-01&endDate=2026-09-30
  @Get('summary')
  getPeriodSummary(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getPeriodSummary(startDate, endDate);
  }

  @Get('customer-sales')
  getCustomerSalesBreakdown(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getCustomerSalesBreakdown(startDate, endDate);
  }

  // e.g. GET /reports/monthly-trend?months=6
  @Get('monthly-trend')
  getMonthlyTrend(@Query('months') months?: string) {
    return this.service.getMonthlyTrend(months ? Number(months) : 6);
  }

  // e.g. GET /reports/daily-trend?startDate=2026-09-01&endDate=2026-09-12
  // Feeds the Dashboard's Sales vs Expenses chart (date-range + Line/Area/Bar).
  @Get('daily-trend')
  getDailyTrend(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getDailyTrend(startDate, endDate);
  }

  // Feeds the Dashboard's "Bank Accounts" panel.
  @Get('bank-accounts-overview')
  getBankAccountsOverview() {
    return this.service.getBankAccountsOverview();
  }

  // e.g. GET /reports/dashboard-extra?startDate=2026-09-01&endDate=2026-09-30
  // Feeds the Dashboard's My Wallets/Invoice/Sales/Expense Breakdown/
  // Product Summary/Customer-Vendor-Product counts/Overdue Invoices/
  // Payable Bills/Cash & Bank/Cash & Bank Activity cards.
  @Get('dashboard-extra')
  getDashboardExtra(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getDashboardExtra(startDate, endDate);
  }

  // Feeds the Dashboard's bottom "Stock Value" bar.
  @Get('stock-value')
  getStockValue() {
    return this.service.getStockValue();
  }

  // Accounts Receivable Aging Report — outstanding invoice balances per
  // customer, bucketed by days overdue (Current / 1-30 / 31-60 / 61-90 / 90+).
  @Get('aging')
  getAgingReport() {
    return this.service.getAgingReport();
  }

  // CRM Step 9 — Combined Dashboard Alerts: overdue invoices, credit-limit
  // breaches, pending approvals, and stuck recurring invoices in one call.
  @Get('alerts')
  getDashboardAlerts() {
    return this.service.getDashboardAlerts();
  }

  // Reports Hub — e.g. GET /reports/sales-tax?startDate=2026-09-01&endDate=2026-09-30
  @Get('sales-tax')
  getSalesTaxReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getSalesTaxReport(startDate, endDate);
  }

  // Sales Tax "Category Based" card — e.g. GET /reports/sales-tax/by-rate?startDate=2026-09-01&endDate=2026-09-30
  @Get('sales-tax/by-rate')
  getSalesTaxByVatRate(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getSalesTaxByVatRate(startDate, endDate);
  }

  // Reports Hub — e.g. GET /reports/purchase-vat?startDate=2026-09-01&endDate=2026-09-30
  @Get('purchase-vat')
  getPurchaseVatReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getPurchaseVatReport(startDate, endDate);
  }

  // VAT return summary for a period: output VAT (sales, less credit
  // notes) - input VAT (purchases, less debit notes) = net VAT payable.
  @Get('vat-summary')
  getVatSummary(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getVatSummary(startDate, endDate);
  }

  // Books Health Check: each control account in the ledger vs the records
  // it summarises (customers, suppliers, stock, bank, VAT).
  @ModuleAccess('accounting')
  @Get('books-check')
  getBooksCheck() {
    return this.booksCheck.run();
  }

  // Books Health Check "Re-post": rebuilds the missing journal entry of
  // one document from the saved document. Admin/Accountant only;
  // strictRoles so a module grant can't open it to other roles.
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
  @ModuleAccess('accounting', { strictRoles: true })
  @Post('books-check/repost')
  repostJournal(@Body() dto: RepostJournalDto, @Req() req: AuthedRequest) {
    return this.journalGaps.repost(dto.sourceType, dto.sourceId, { userId: req.user?.userId, email: req.user?.email });
  }

  // Reports Hub — e.g. GET /reports/income-statement?startDate=2026-09-01&endDate=2026-09-30
  @Get('income-statement')
  getIncomeStatement(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getIncomeStatement(startDate, endDate);
  }

  // Reports Hub — e.g. GET /reports/balance-sheet?asOfDate=2026-09-30 (defaults to today)
  @Get('balance-sheet')
  getBalanceSheet(@Query('asOfDate') asOfDate?: string) {
    return this.service.getBalanceSheet(asOfDate || omanToday());
  }

  // Reports Hub — Ledger Report: e.g. GET /reports/ledger/<accountId>?startDate=...&endDate=...
  @Get('ledger/:accountId')
  getLedger(@Param('accountId') accountId: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getLedgerForAccount(accountId, startDate, endDate);
  }

  // Reports Hub — e.g. GET /reports/product-sales?startDate=2026-09-01&endDate=2026-09-30
  @Get('product-sales')
  getProductSalesReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getProductSalesReport(startDate, endDate);
  }

  // Reports Hub — e.g. GET /reports/product-purchase?startDate=2026-09-01&endDate=2026-09-30
  @Get('product-purchase')
  getProductPurchaseReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.service.getProductPurchaseReport(startDate, endDate);
  }

  // Reports Hub — full stock valuation table.
  @Get('inventory-detail')
  getInventoryDetail() {
    return this.service.getInventoryDetail();
  }
}
