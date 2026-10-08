import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RawMaterialService } from '../inventory/raw-material.service';
import { FinishedGoodService } from '../inventory/finished-good.service';
import { SalesOrderService } from '../sales/sales-order.service';
import { ProductionOrderService } from '../manufacturing/production-order.service';
import { AccountingSummaryService } from '../accounting/accounting-summary.service';
import { ExpenseService } from '../accounting/expense.service';
import { InvoiceService } from '../invoice/invoice.service';
import { InvoicePaymentService } from '../invoice/invoice-payment.service';
import { SalesReturnService } from '../invoice/sales-return.service';
import { CustomerService } from '../customer/customer.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { ApprovalService } from '../approval/approval.service';
import { ReimbursementService } from '../reimbursement/reimbursement.service';
import { PurchaseOrderService } from '../supplier/purchase-order.service';
import { SupplierService } from '../supplier/supplier.service';
import { JournalEntryService } from '../journal/journal-entry.service';
import { RecurringInvoice } from '../recurring-invoice/recurring-invoice.entity';
import { omanToday } from '../common/oman-date';

@Injectable()
export class ReportingService {
  constructor(
    private rawMaterialService: RawMaterialService,
    private finishedGoodService: FinishedGoodService,
    private salesOrderService: SalesOrderService,
    private productionOrderService: ProductionOrderService,
    private accountingSummaryService: AccountingSummaryService,
    private expenseService: ExpenseService,
    private invoiceService: InvoiceService,
    private invoicePaymentService: InvoicePaymentService,
    private salesReturnService: SalesReturnService,
    private customerService: CustomerService,
    private bankAccountService: BankAccountService,
    // CRM Step 9 — read-only, used only by getDashboardAlerts().
    private approvalService: ApprovalService,
    // Read-only — pending-claims count for Alerts, paid-daily-totals for
    // the trend chart (see getDashboardAlerts()/getDailyTrend() below).
    private reimbursementService: ReimbursementService,
    // Reports Hub — Purchase VAT report + supplier name lookup.
    private purchaseOrderService: PurchaseOrderService,
    private supplierService: SupplierService,
    // Reports Hub — Income Statement + Balance Sheet.
    private journalEntryService: JournalEntryService,
    @InjectRepository(RecurringInvoice)
    private recurringInvoiceRepo: Repository<RecurringInvoice>,
  ) {}

  // Single dashboard-style endpoint — everything a quick daily check
  // needs, in one call, so the frontend dashboard doesn't need to
  // stitch together five separate requests.
  async getLowStockReport() {
    const [rawMaterials, finishedGoods] = await Promise.all([
      this.rawMaterialService.findLowStock(),
      this.finishedGoodService.findLowStock(),
    ]);
    return { rawMaterials, finishedGoods };
  }

  async getPeriodSummary(startDate: string, endDate: string) {
    const [sales, production, accounting] = await Promise.all([
      this.salesOrderService.getSummaryInRange(startDate, endDate),
      this.productionOrderService.getSummaryInRange(startDate, endDate),
      this.accountingSummaryService.getSummary(startDate, endDate),
    ]);
    return { period: { startDate, endDate }, sales, production, accounting };
  }

  // Revenue grouped by customer, with customer names attached (the
  // invoice-level breakdown only has customerId, so we join names here).
  async getCustomerSalesBreakdown(startDate: string, endDate: string) {
    const rows = await this.invoiceService.getCustomerBreakdownInRange(startDate, endDate);
    // Batch-fetch all customers once instead of one findOne() per row.
    const customers = await this.customerService.findAll();
    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    return rows.map((row) => ({
      ...row,
      customerName: customerById.get(row.customerId)?.name || 'Unknown customer',
    }));
  }

  getMonthlyTrend(monthsBack: number) {
    return this.invoiceService.getMonthlyTrend(monthsBack);
  }

  // Sales Tax (Output VAT) report — invoice rows in range, customer
  // names attached (same join pattern as getCustomerSalesBreakdown).
  async getSalesTaxReport(startDate: string, endDate: string) {
    const report = await this.invoiceService.getSalesTaxReport(startDate, endDate);
    const customers = await this.customerService.findAll();
    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    return {
      ...report,
      rows: report.rows.map((r) => ({ ...r, customerName: customerById.get(r.customerId)?.name || 'Unknown customer' })),
    };
  }

  // Sales Tax — "Category Based" card (grouped by VAT rate; see
  // InvoiceService.getSalesTaxByVatRate for why).
  async getSalesTaxByVatRate(startDate: string, endDate: string) {
    return this.invoiceService.getSalesTaxByVatRate(startDate, endDate);
  }

  // Purchase VAT (Input VAT) report — received PO rows in range, supplier
  // names attached.
  async getPurchaseVatReport(startDate: string, endDate: string) {
    const report = await this.purchaseOrderService.getVatReportInRange(startDate, endDate);
    const suppliers = await this.supplierService.findAll();
    const supplierById = new Map(suppliers.map((s: any) => [s.id, s]));
    return {
      ...report,
      rows: report.rows.map((r) => ({ ...r, supplierName: supplierById.get(r.supplierId)?.name || 'Unknown supplier' })),
    };
  }

  async getVatSummary(startDate: string, endDate: string) {
    const sales = await this.invoiceService.getSalesTaxReport(startDate, endDate);
    const purchases = await this.purchaseOrderService.getVatReportInRange(startDate, endDate);
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    return {
      period: { startDate, endDate },
      taxableSales: sales.totalTaxableSales,
      outputVat: sales.totalVat,
      creditNotesVat: sales.creditNotesVat,
      taxablePurchases: purchases.totalTaxablePurchases,
      inputVat: purchases.totalVat,
      debitNotesVat: purchases.debitNotesVat,
      netVatPayable: round3(sales.totalVat - purchases.totalVat), // negative = refundable
      purchaseRowsMissingDocuments: purchases.rowsMissingDocuments,
    };
  }

  getIncomeStatement(startDate: string, endDate: string) {
    return this.journalEntryService.getIncomeStatement(startDate, endDate);
  }

  getBalanceSheet(asOfDate: string) {
    return this.journalEntryService.getBalanceSheet(asOfDate);
  }

  getLedgerForAccount(accountId: string, startDate?: string, endDate?: string) {
    return this.journalEntryService.getLedgerForAccount(accountId, startDate, endDate);
  }

  // Product Sales report — revenue by product, product names attached.
  async getProductSalesReport(startDate: string, endDate: string) {
    const rows = await this.invoiceService.getProductSalesBreakdown(startDate, endDate);
    const finishedGoods = await this.finishedGoodService.findAll();
    const fgById = new Map(finishedGoods.map((f: any) => [f.id, f]));
    return rows.map((r) => ({
      ...r,
      productName: r.finishedGoodId ? fgById.get(r.finishedGoodId)?.name || 'Unknown product' : r.description,
    }));
  }

  // Product Purchase report — cost by raw material, material names attached.
  async getProductPurchaseReport(startDate: string, endDate: string) {
    const rows = await this.purchaseOrderService.getProductPurchaseBreakdown(startDate, endDate);
    const rawMaterials = await this.rawMaterialService.findAll();
    const rmById = new Map(rawMaterials.map((m: any) => [m.id, m]));
    return rows.map((r) => ({
      ...r,
      materialName: rmById.get(r.rawMaterialId)?.name || 'Unknown material',
      unit: rmById.get(r.rawMaterialId)?.unit,
    }));
  }

  // Inventory Report — full stock valuation table (getStockValue() above
  // only returns the Dashboard's aggregate total; this is the per-item
  // detail the Reports Hub card needs).
  async getInventoryDetail() {
    const [rawMaterials, finishedGoods] = await Promise.all([
      this.rawMaterialService.findAll(),
      this.finishedGoodService.findAll(),
    ]);
    const rawRows = rawMaterials.map((m: any) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      quantityInStock: Number(m.quantityInStock),
      costPerUnit: Number(m.costPerUnit),
      value: this.round3(Number(m.quantityInStock) * Number(m.costPerUnit)),
      lowStock: Number(m.quantityInStock) <= Number(m.lowStockThreshold || 0),
    }));
    const finishedRows = finishedGoods.map((g: any) => ({
      id: g.id,
      name: g.name,
      unit: g.unit,
      quantityInStock: Number(g.quantityInStock),
      sellingPrice: Number(g.sellingPrice),
      value: this.round3(Number(g.quantityInStock) * Number(g.sellingPrice)),
      lowStock: Number(g.quantityInStock) <= Number(g.lowStockThreshold || 0),
    }));
    const totalRawValue = this.round3(rawRows.reduce((s, r) => s + r.value, 0));
    const totalFinishedValue = this.round3(finishedRows.reduce((s, r) => s + r.value, 0));
    return {
      rawMaterials: rawRows,
      finishedGoods: finishedRows,
      totalRawValue,
      totalFinishedValue,
      totalValue: this.round3(totalRawValue + totalFinishedValue),
    };
  }

  // Day-by-day Sales (revenue) vs Expenses within a date range — feeds
  // the Dashboard's trend chart (Line/Area/Bar). Both come from the
  // ledger, the same basis as getSummary()'s netProfit and the Income
  // Statement: sales net of VAT/discount, expenses incl. cost of goods
  // sold, salaries and depreciation.
  async getDailyTrend(startDate: string, endDate: string) {
    const byDate = await this.journalEntryService.getDailyIncomeExpense(startDate, endDate);

    const days: { date: string; sales: number; expenses: number }[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      days.push({
        date: iso,
        sales: byDate.get(iso)?.revenue || 0,
        expenses: byDate.get(iso)?.expense || 0,
      });
    }
    return days;
  }

  // Dashboard's "Bank Accounts" panel — every account with its balance,
  // plus the combined total.
  async getBankAccountsOverview() {
    const accounts = await this.bankAccountService.findAll();
    const total = accounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
    return { accounts, total };
  }

  // Accounts Receivable Aging Report — outstanding invoice balances per
  // customer, bucketed by how many days overdue (Current / 1-30 / 31-60 /
  // 61-90 / 90+). Attaches customer names + phone (for a payment-reminder
  // follow-up call) on top of InvoiceService's customerId-only rows.
  async getAgingReport() {
    const rows = await this.invoiceService.getAgingReportRows();
    // Batch-fetch all customers once instead of one findOne() per row.
    const customers = await this.customerService.findAll();
    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    const withNames = rows.map((row) => {
      const customer = customerById.get(row.customerId);
      return {
        ...row,
        customerName: customer?.name || 'Unknown customer',
        customerPhone: customer?.phone,
      };
    });
    const grandTotal = rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        days1to30: acc.days1to30 + r.days1to30,
        days31to60: acc.days31to60 + r.days31to60,
        days61to90: acc.days61to90 + r.days61to90,
        days90plus: acc.days90plus + r.days90plus,
        totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
      }),
      { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 },
    );
    return { asOfDate: omanToday(), rows: withNames, grandTotal };
  }

  // Dashboard's bottom "Stock Value" bar — raw materials valued at their
  // cost price, finished goods valued at their selling price (finished
  // goods have no separate cost field), plus a product count.
  async getStockValue() {
    const [rawMaterials, finishedGoods] = await Promise.all([
      this.rawMaterialService.findAll(),
      this.finishedGoodService.findAll(),
    ]);
    const rawValue = rawMaterials.reduce((sum, m) => sum + Number(m.quantityInStock) * Number(m.costPerUnit), 0);
    const finishedValue = finishedGoods.reduce((sum, g) => sum + Number(g.quantityInStock) * Number(g.sellingPrice), 0);
    return {
      value: rawValue + finishedValue,
      productCount: rawMaterials.length + finishedGoods.length,
    };
  }

  // CRM Step 9 — Combined Dashboard Alerts. Pulls together things a
  // manager should notice at a glance — overdue receivables, customers
  // over their credit limit, pending approvals, and recurring invoices
  // that should have generated by now but haven't — into one call so the
  // Dashboard doesn't need five separate widgets each polling on its own.
  async getDashboardAlerts() {
    const [agingRows, customers, pendingApprovals, lowStock, recurringInvoices, reorderSuggestions, pendingReimbursements] = await Promise.all([
      this.invoiceService.getAgingReportRows(),
      this.customerService.findAll(),
      this.approvalService.findPendingCombined(),
      this.getLowStockReport(),
      this.recurringInvoiceRepo.find({ where: { active: true } }),
      this.rawMaterialService.getReorderSuggestions(),
      this.reimbursementService.getPendingSummary(),
    ]);
    const customerById = new Map(customers.map((c: any) => [c.id, c]));

    // Overdue = any bucket past "current" (i.e. past its due date).
    const overdueRows = agingRows.filter((r) => r.totalOutstanding - r.current > 0.001);
    const overdueTotal = overdueRows.reduce((sum, r) => sum + (r.totalOutstanding - r.current), 0);
    const worstOverdue = [...overdueRows]
      .sort((a, b) => b.oldestDaysOverdue - a.oldestDaysOverdue)
      .slice(0, 5)
      .map((r) => ({
        customerId: r.customerId,
        customerName: customerById.get(r.customerId)?.name || 'Unknown customer',
        outstanding: this.round3(r.totalOutstanding - r.current),
        oldestDaysOverdue: r.oldestDaysOverdue,
      }));

    // Credit limit breaches: customer's total outstanding (all buckets,
    // including "current") exceeds their configured creditLimit. A blank
    // or zero creditLimit means unlimited — same rule InvoiceService uses.
    const creditLimitBreaches = agingRows
      .map((r) => {
        const customer = customerById.get(r.customerId);
        const limit = Number(customer?.creditLimit || 0);
        if (!customer || limit <= 0) return null;
        if (r.totalOutstanding <= limit) return null;
        return {
          customerId: r.customerId,
          customerName: customer.name,
          creditLimit: limit,
          outstanding: r.totalOutstanding,
          overBy: this.round3(r.totalOutstanding - limit),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.overBy - a.overBy);

    // Recurring invoices whose nextRunDate has already passed but are
    // still marked active — the daily cron should have generated (or
    // queued for approval) these; if nextRunDate is still in the past,
    // something is stuck (cron not running, generation error, etc.).
    const today = this.todayStr();
    const stuckRecurringInvoices = recurringInvoices
      .filter((ri) => ri.nextRunDate < today)
      .map((ri) => ({
        id: ri.id,
        label: ri.label,
        customerName: customerById.get(ri.customerId)?.name || 'Unknown customer',
        nextRunDate: ri.nextRunDate,
        daysStuck: Math.floor((new Date(today).getTime() - new Date(ri.nextRunDate).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.daysStuck - a.daysStuck);

    const lowStockCount = lowStock.rawMaterials.length + lowStock.finishedGoods.length;

    return {
      overdueInvoices: { count: overdueRows.length, totalOutstanding: this.round3(overdueTotal), worst: worstOverdue },
      creditLimitBreaches,
      pendingApprovals: { count: pendingApprovals.length, items: pendingApprovals.slice(0, 5) },
      stuckRecurringInvoices,
      lowStock: { count: lowStockCount },
      // Subset of lowStock (raw materials only) — surfaced separately so
      // the Dashboard can link straight to "Reorder Suggestions" on the
      // Suppliers page. Not added into totalAlertCount since it would
      // double-count against lowStock.count.
      reorderNeeded: { count: reorderSuggestions.totalItems },
      pendingReimbursements,
      totalAlertCount:
        overdueRows.length +
        creditLimitBreaches.length +
        pendingApprovals.length +
        stuckRecurringInvoices.length +
        lowStockCount +
        pendingReimbursements.count,
    };
  }

  // Everything the redesigned Dashboard's extra cards need (My Wallets,
  // Invoice, Sales, Expense Breakdown, Product Summary, Customer/Vendor/
  // Product counts, Overdue Invoices, Payable Bills, Cash & Bank +
  // Activity table) — bundled into one call, same "one dashboard-style
  // endpoint" philosophy as getDashboardAlerts()/getLowStockReport()
  // above, so the frontend doesn't have to fan out a dozen requests.
  async getDashboardExtra(startDate: string, endDate: string) {
    const [
      wallet,
      invoiceTotals,
      totalCollected,
      returnAmount,
      productSales,
      expenseTotals,
      rawMaterials,
      finishedGoods,
      customers,
      suppliers,
      overdueInvoices,
      payableBillsRaw,
      bankAccounts,
      cashBankActivity,
    ] = await Promise.all([
      this.bankAccountService.getWalletSummary(startDate, endDate),
      this.invoiceService.getTotalsInRange(startDate, endDate),
      this.invoicePaymentService.getTotalInRange(startDate, endDate),
      this.salesReturnService.getApprovedTotalInRange(startDate, endDate),
      this.invoiceService.getProductSalesBreakdown(startDate, endDate),
      this.expenseService.getTotalInRange(startDate, endDate),
      this.rawMaterialService.findAll(),
      this.finishedGoodService.findAll(),
      this.customerService.findAll(),
      this.supplierService.findAll(),
      this.invoiceService.getOverdueInvoicesList(),
      this.purchaseOrderService.getPayableBillsList(),
      this.bankAccountService.findAll(),
      this.bankAccountService.getActivityInRange(startDate, endDate),
    ]);

    // COGS — sum of (quantity sold × current costPerUnit) for every
    // finished-good line sold in range. Uses today's average cost, not
    // the cost at the moment each invoice was issued (this system
    // doesn't snapshot cost-per-sale) — a reasonable approximation for a
    // dashboard figure, not a substitute for a proper COGS ledger.
    const finishedGoodById = new Map(finishedGoods.map((f: any) => [f.id, f]));
    const soldFinishedGoodIds = new Set<string>();
    let cogs = 0;
    for (const row of productSales) {
      if (!row.finishedGoodId) continue;
      soldFinishedGoodIds.add(row.finishedGoodId);
      const fg = finishedGoodById.get(row.finishedGoodId);
      if (fg) cogs += row.quantity * Number(fg.costPerUnit || 0);
    }
    cogs = this.round3(cogs);
    const totalSales = invoiceTotals.total;
    const grossProfit = this.round3(totalSales - returnAmount - cogs);

    const outOfStock =
      rawMaterials.filter((m: any) => Number(m.quantityInStock) <= 0).length +
      finishedGoods.filter((f: any) => Number(f.quantityInStock) <= 0).length;
    const lowStock = await this.getLowStockReport();
    const lowStockAlert = lowStock.rawMaterials.length + lowStock.finishedGoods.length;
    const noSalesProducts = finishedGoods.filter((f: any) => !soldFinishedGoodIds.has(f.id)).length;

    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    const overdueInvoicesWithNames = overdueInvoices.map((r) => ({
      ...r,
      customerName: customerById.get(r.customerId)?.name || 'Unknown customer',
    }));

    const supplierById = new Map(suppliers.map((s: any) => [s.id, s]));
    const payableBills = payableBillsRaw.map((r) => ({
      ...r,
      supplierName: supplierById.get(r.supplierId)?.name || 'Unknown supplier',
    }));

    const cashTotal = bankAccounts.filter((a: any) => a.type === 'cash').reduce((s: number, a: any) => s + Number(a.currentBalance), 0);
    const bankTotal = bankAccounts.filter((a: any) => a.type === 'bank').reduce((s: number, a: any) => s + Number(a.currentBalance), 0);

    return {
      wallet,
      invoiceCard: { totalInvoiced: invoiceTotals.total, totalCollected },
      salesCard: { totalSales, returnAmount, cogs, grossProfit },
      expenseBreakdown: Object.entries(expenseTotals.byCategory).map(([category, amount]) => ({
        category,
        amount: this.round3(amount as number),
      })),
      productSummary: {
        outOfStock,
        lowStockAlert,
        noSalesProducts,
        totalProducts: rawMaterials.length + finishedGoods.length,
      },
      counts: {
        customers: customers.length,
        vendors: suppliers.length,
        products: rawMaterials.length + finishedGoods.length,
      },
      overdueInvoices: overdueInvoicesWithNames,
      payableBills,
      cashBank: { cash: cashTotal, bank: bankTotal, accounts: bankAccounts },
      cashBankActivity,
    };
  }

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private todayStr() {
    return omanToday();
  }
}
