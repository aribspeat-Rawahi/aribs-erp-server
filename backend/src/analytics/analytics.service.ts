import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { InvoiceService } from '../invoice/invoice.service';
import { CustomerService } from '../customer/customer.service';
import { RawMaterialService } from '../inventory/raw-material.service';
import { FinishedGoodService } from '../inventory/finished-good.service';
import { JournalEntryService } from '../journal/journal-entry.service';
import { ProductionBatchConsumption } from '../manufacturing/production-batch-consumption.entity';
import { omanToday, omanDate } from '../common/oman-date';

// New "Analytics" tab (Accounting → Analytics) — goes one layer past the
// existing Reports Hub: instead of raw period totals, these combine
// several existing services' data to answer "which product/customer/
// material is actually driving (or dragging) the business" questions.
// Every method here is read-only and re-derives its numbers from the
// same source data the Reports Hub and Dashboard already use — nothing
// new is stored.
@Injectable()
export class AnalyticsService {
  constructor(
    private invoiceService: InvoiceService,
    private customerService: CustomerService,
    private rawMaterialService: RawMaterialService,
    private finishedGoodService: FinishedGoodService,
    private journalEntryService: JournalEntryService,
    @InjectRepository(ProductionBatchConsumption)
    private consumptionRepo: Repository<ProductionBatchConsumption>,
  ) {}

  private round3(n: number) {
    return Math.round(n * 1000) / 1000;
  }

  private todayStr() {
    return omanToday();
  }

  // Per-product revenue, COGS (quantity sold × current costPerUnit — same
  // approximation ReportingService.getDashboardExtra() uses for gross
  // profit, since this system doesn't snapshot cost-per-sale) and margin,
  // for a date range. Answers "which products are actually profitable?"
  // now that Sales Order completion posts real COGS to the ledger.
  async getProductProfitability(startDate: string, endDate: string) {
    const [salesRows, finishedGoods] = await Promise.all([
      this.invoiceService.getProductSalesBreakdown(startDate, endDate),
      this.finishedGoodService.findAll(),
    ]);
    const fgById = new Map(finishedGoods.map((f: any) => [f.id, f]));

    const rows = salesRows.map((r) => {
      const fg = r.finishedGoodId ? fgById.get(r.finishedGoodId) : null;
      const costPerUnit = fg ? Number(fg.costPerUnit || 0) : 0;
      const cogs = this.round3(r.quantity * costPerUnit);
      const margin = this.round3(r.total - cogs);
      const marginPct = r.total > 0 ? this.round3((margin / r.total) * 100) : 0;
      return {
        finishedGoodId: r.finishedGoodId,
        productName: fg ? fg.name : r.description,
        quantitySold: r.quantity,
        revenue: r.total,
        cogs,
        margin,
        marginPct,
      };
    });
    rows.sort((a, b) => b.margin - a.margin);

    const totals = rows.reduce(
      (acc, r) => ({ revenue: acc.revenue + r.revenue, cogs: acc.cogs + r.cogs, margin: acc.margin + r.margin }),
      { revenue: 0, cogs: 0, margin: 0 },
    );
    return {
      period: { startDate, endDate },
      rows,
      totals: {
        revenue: this.round3(totals.revenue),
        cogs: this.round3(totals.cogs),
        margin: this.round3(totals.margin),
        marginPct: totals.revenue > 0 ? this.round3((totals.margin / totals.revenue) * 100) : 0,
      },
    };
  }

  // Top customers by revenue in the period, with order count, average
  // order value, current outstanding balance (from the Aging report) and
  // an overall repeat-purchase rate — how many of this period's customers
  // ordered more than once.
  async getCustomerAnalytics(startDate: string, endDate: string) {
    const [breakdown, agingRows, customers] = await Promise.all([
      this.invoiceService.getCustomerBreakdownInRange(startDate, endDate),
      this.invoiceService.getAgingReportRows(),
      this.customerService.findAll(),
    ]);
    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    const outstandingByCustomer = new Map(agingRows.map((a) => [a.customerId, a.totalOutstanding]));

    const rows = breakdown.map((b) => ({
      customerId: b.customerId,
      customerName: customerById.get(b.customerId)?.name || 'Unknown customer',
      orderCount: b.count,
      totalRevenue: this.round3(b.total),
      avgOrderValue: b.count > 0 ? this.round3(b.total / b.count) : 0,
      outstanding: this.round3(outstandingByCustomer.get(b.customerId) || 0),
    }));

    const repeatCustomers = breakdown.filter((b) => b.count > 1).length;
    return {
      period: { startDate, endDate },
      rows,
      summary: {
        totalCustomers: breakdown.length,
        repeatCustomers,
        repeatPurchaseRatePct: breakdown.length > 0 ? this.round3((repeatCustomers / breakdown.length) * 100) : 0,
      },
    };
  }

  // Monthly Revenue / Expense / Net Profit for the last N months (oldest
  // first, current month included), each with a year-over-year comparison
  // against the same calendar month last year — sourced directly from
  // JournalEntryService.getIncomeStatement() so it lines up exactly with
  // the Income Statement report, not a separate approximation.
  async getRevenueTrend(monthsBack: number) {
    const now = new Date();
    const months: { year: number; month: number; label: string; startDate: string; endDate: string }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-indexed
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      months.push({ year, month, label, startDate, endDate });
    }

    const rows: {
      label: string;
      startDate: string;
      endDate: string;
      revenue: number;
      expense: number;
      netProfit: number;
      priorYearRevenue: number;
      priorYearNetProfit: number;
      yoyRevenueChangePct: number | null;
      yoyProfitChangePct: number | null;
    }[] = [];
    for (const m of months) {
      const current = await this.journalEntryService.getIncomeStatement(m.startDate, m.endDate);
      const priorYearStart = `${m.year - 1}-${String(m.month + 1).padStart(2, '0')}-01`;
      const priorYearLastDay = new Date(m.year - 1, m.month + 1, 0).getDate();
      const priorYearEnd = `${m.year - 1}-${String(m.month + 1).padStart(2, '0')}-${String(priorYearLastDay).padStart(2, '0')}`;
      const priorYear = await this.journalEntryService.getIncomeStatement(priorYearStart, priorYearEnd);

      const yoyRevenueChangePct =
        priorYear.totalRevenue > 0
          ? this.round3(((current.totalRevenue - priorYear.totalRevenue) / priorYear.totalRevenue) * 100)
          : null;
      const yoyProfitChangePct =
        priorYear.netProfit !== 0
          ? this.round3(((current.netProfit - priorYear.netProfit) / Math.abs(priorYear.netProfit)) * 100)
          : null;

      rows.push({
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate,
        revenue: this.round3(current.totalRevenue),
        expense: this.round3(current.totalExpense),
        netProfit: this.round3(current.netProfit),
        priorYearRevenue: this.round3(priorYear.totalRevenue),
        priorYearNetProfit: this.round3(priorYear.netProfit),
        yoyRevenueChangePct,
        yoyProfitChangePct,
      });
    }
    return { months: rows };
  }

  // Raw material consumption (from actual Production Order batch
  // consumption records) and finished good sales over the trailing
  // `daysBack` window, against current stock — flags anything with zero
  // movement in the window as slow-moving, and estimates days of stock
  // remaining at the recent usage/sales rate. No historical stock
  // snapshots exist in this system, so "average inventory" is
  // approximated with today's stock level — the same kind of
  // approximation already used for Dashboard COGS.
  async getInventoryTurnover(daysBack: number) {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    const [consumptions, rawMaterials, salesRows, finishedGoods] = await Promise.all([
      this.consumptionRepo.find({ where: { createdAt: Between(startDate, endDate) } }),
      this.rawMaterialService.findAll(),
      this.invoiceService.getProductSalesBreakdown(omanDate(startDate), this.todayStr()),
      this.finishedGoodService.findAll(),
    ]);

    const consumedByMaterial = new Map<string, number>();
    for (const c of consumptions) {
      consumedByMaterial.set(c.rawMaterialId, (consumedByMaterial.get(c.rawMaterialId) || 0) + Number(c.quantityConsumed));
    }
    const rawMaterialRows = rawMaterials.map((m: any) => {
      const consumed = this.round3(consumedByMaterial.get(m.id) || 0);
      const avgDailyUsage = this.round3(consumed / daysBack);
      const stockValue = this.round3(Number(m.quantityInStock) * Number(m.costPerUnit));
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        quantityInStock: Number(m.quantityInStock),
        stockValue,
        consumedInPeriod: consumed,
        avgDailyUsage,
        daysOfStockRemaining: avgDailyUsage > 0 ? this.round3(Number(m.quantityInStock) / avgDailyUsage) : null,
        slowMoving: consumed <= 0,
      };
    });

    const soldByProduct = new Map<string, number>();
    for (const r of salesRows) {
      if (r.finishedGoodId) soldByProduct.set(r.finishedGoodId, (soldByProduct.get(r.finishedGoodId) || 0) + r.quantity);
    }
    const finishedGoodRows = finishedGoods.map((g: any) => {
      const sold = this.round3(soldByProduct.get(g.id) || 0);
      const avgDailySales = this.round3(sold / daysBack);
      return {
        id: g.id,
        name: g.name,
        unit: g.unit,
        quantityInStock: Number(g.quantityInStock),
        stockValue: this.round3(Number(g.quantityInStock) * Number(g.costPerUnit || 0)),
        soldInPeriod: sold,
        avgDailySales,
        daysOfStockRemaining: avgDailySales > 0 ? this.round3(Number(g.quantityInStock) / avgDailySales) : null,
        slowMoving: sold <= 0,
      };
    });

    return {
      period: { startDate: omanDate(startDate), endDate: this.todayStr(), daysBack },
      rawMaterials: rawMaterialRows.sort((a, b) => a.consumedInPeriod - b.consumedInPeriod),
      finishedGoods: finishedGoodRows.sort((a, b) => a.soldInPeriod - b.soldInPeriod),
      slowMovingCount:
        rawMaterialRows.filter((r) => r.slowMoving && r.quantityInStock > 0).length +
        finishedGoodRows.filter((r) => r.slowMoving && r.quantityInStock > 0).length,
    };
  }
}
