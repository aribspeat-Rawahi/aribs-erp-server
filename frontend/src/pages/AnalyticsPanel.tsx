import { useEffect, useState } from 'react';
import { TrendingUp, Users, Boxes, LineChart as LineChartIcon, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { Card, StatCard, EmptyState, inputClass } from '../components/ui';
import { formatQuantityWithUnit } from '../utils/formatQuantity';
import { localISODate } from '../utils/dates';

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => localISODate(d);
  return { startDate: iso(start), endDate: iso(end) };
}

interface ProfitabilityRow {
  finishedGoodId: string | null;
  productName: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  margin: number;
  marginPct: number;
}
interface CustomerAnalyticsRow {
  customerId: string;
  customerName: string;
  orderCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  outstanding: number;
}
interface RevenueTrendMonth {
  label: string;
  revenue: number;
  expense: number;
  netProfit: number;
  yoyRevenueChangePct: number | null;
  yoyProfitChangePct: number | null;
}
interface TurnoverRow {
  id: string;
  name: string;
  unit: string;
  quantityInStock: number;
  stockValue: number;
  consumedInPeriod?: number;
  soldInPeriod?: number;
  daysOfStockRemaining: number | null;
  slowMoving: boolean;
}

function YoyBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`text-xs font-medium ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
      {positive ? '+' : ''}
      {pct.toFixed(1)}% YoY
    </span>
  );
}

function RevenueTrendChart({ months }: { months: RevenueTrendMonth[] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.expense)));
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-3 h-44 px-2 min-w-[680px] sm:min-w-0">
        {months.map((m) => (
          <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-xs font-medium text-ink">{m.netProfit.toFixed(0)}</div>
            <div className="w-full flex items-end gap-0.5 h-32">
              <div
                className="flex-1 bg-brand-500 rounded-t-sm min-h-[2px]"
                style={{ height: `${Math.max(2, (m.revenue / max) * 100)}%` }}
                title={`Revenue: ${m.revenue.toFixed(3)} OMR`}
              />
              <div
                className="flex-1 bg-amber-400 rounded-t-sm min-h-[2px]"
                style={{ height: `${Math.max(2, (m.expense / max) * 100)}%` }}
                title={`Expense: ${m.expense.toFixed(3)} OMR`}
              />
            </div>
            <div className="text-xs text-muted whitespace-nowrap">{m.label}</div>
            <YoyBadge pct={m.yoyRevenueChangePct} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Analytics tab (Accounting → Analytics) — goes past the Reports Hub's
// period totals into which product/customer/material is actually driving
// (or dragging) the business, by combining data the system already
// tracks. Four sections, each independently loaded so one slow query
// doesn't block the others.
export default function AnalyticsPanel() {
  const [{ startDate, endDate }, setRange] = useState(monthRange());
  const [loading, setLoading] = useState(true);

  const [profitability, setProfitability] = useState<{ rows: ProfitabilityRow[]; totals: any } | null>(null);
  const [customers, setCustomers] = useState<{ rows: CustomerAnalyticsRow[]; summary: any } | null>(null);
  const [trend, setTrend] = useState<RevenueTrendMonth[]>([]);
  const [turnover, setTurnover] = useState<{ rawMaterials: TurnoverRow[]; finishedGoods: TurnoverRow[]; slowMovingCount: number } | null>(
    null,
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/analytics/product-profitability', { params: { startDate, endDate } }),
      api.get('/analytics/customer-analytics', { params: { startDate, endDate } }),
    ])
      .then(([p, c]) => {
        setProfitability(p.data);
        setCustomers(c.data);
      })
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  // Revenue Trend (12 months) and Inventory Turnover (90 days) are not
  // tied to the range picker above — loaded once on their own, same as
  // ReportsPanel's Aging report.
  useEffect(() => {
    api.get('/analytics/revenue-trend', { params: { months: 12 } }).then((res) => setTrend(res.data.months));
    api.get('/analytics/inventory-turnover', { params: { days: 90 } }).then((res) => setTurnover(res.data));
  }, []);

  // Profitability rows carry no unit - take it from the product (the
  // turnover data already lists every finished good with its unit). A
  // custom line with no product shows the plain number.
  function quantitySoldLabel(r: ProfitabilityRow) {
    const fg = r.finishedGoodId ? turnover?.finishedGoods.find((f) => f.id === r.finishedGoodId) : undefined;
    return fg ? formatQuantityWithUnit(r.quantitySold, fg.unit) : String(Math.round(Number(r.quantitySold) * 1000) / 1000);
  }

  const topProduct = profitability?.rows[0];
  const topCustomer = customers?.rows[0];
  const slowMovingRaw = turnover?.rawMaterials.filter((r) => r.slowMoving && r.quantityInStock > 0) || [];
  const slowMovingFinished = turnover?.finishedGoods.filter((r) => r.slowMoving && r.quantityInStock > 0) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <input
          type="date"
          className={inputClass}
          value={startDate}
          onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
        />
        <span className="text-muted text-sm">to</span>
        <input type="date" className={inputClass} value={endDate} onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          label="Best Margin Product"
          value={topProduct ? topProduct.productName : '—'}
          sub={topProduct ? `${topProduct.marginPct.toFixed(1)}% margin` : undefined}
        />
        <StatCard
          icon={Users}
          label="Top Customer"
          value={topCustomer ? topCustomer.customerName : '—'}
          sub={topCustomer ? `${topCustomer.totalRevenue.toFixed(3)} OMR` : undefined}
        />
        <StatCard
          icon={Users}
          label="Repeat Purchase Rate"
          value={customers ? `${customers.summary.repeatPurchaseRatePct.toFixed(1)}%` : '—'}
          sub={customers ? `${customers.summary.repeatCustomers} of ${customers.summary.totalCustomers} customers` : undefined}
        />
        <StatCard
          icon={AlertTriangle}
          label="Slow-moving Items"
          value={turnover ? String(turnover.slowMovingCount) : '—'}
          sub="No movement in 90 days"
          tone={turnover && turnover.slowMovingCount > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* Product Profitability */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
          <TrendingUp size={15} />
          Product Profitability
        </div>
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : !profitability || profitability.rows.length === 0 ? (
          <EmptyState>No sales in this range.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-black/10">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Qty Sold</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Revenue</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">COGS</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Margin</th>
                  <th className="py-2 pl-3 font-medium text-right whitespace-nowrap">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {profitability.rows.map((r) => (
                  <tr key={r.finishedGoodId || r.productName}>
                    <td className="py-2 pr-3 text-ink font-medium">{r.productName}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-ink/70">{quantitySoldLabel(r)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-ink/70">{r.revenue.toFixed(3)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-ink/70">{r.cogs.toFixed(3)}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {r.margin.toFixed(3)}
                    </td>
                    <td className={`py-2 pl-3 text-right whitespace-nowrap font-semibold ${r.marginPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {r.marginPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/10 font-semibold text-ink">
                  <td className="py-2 pr-3">Total</td>
                  <td />
                  <td className="py-2 px-3 text-right whitespace-nowrap">{profitability.totals.revenue.toFixed(3)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{profitability.totals.cogs.toFixed(3)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{profitability.totals.margin.toFixed(3)}</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">{profitability.totals.marginPct.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Customer Analytics */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
          <Users size={15} />
          Customer Analytics
        </div>
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : !customers || customers.rows.length === 0 ? (
          <EmptyState>No sales in this range.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-black/10">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Orders</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Total Revenue</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Avg Order Value</th>
                  <th className="py-2 pl-3 font-medium text-right whitespace-nowrap">Outstanding Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {customers.rows.map((c) => (
                  <tr key={c.customerId}>
                    <td className="py-2 pr-3 text-ink font-medium">{c.customerName}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-ink/70">{c.orderCount}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-semibold text-ink">{c.totalRevenue.toFixed(3)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-ink/70">{c.avgOrderValue.toFixed(3)}</td>
                    <td className={`py-2 pl-3 text-right whitespace-nowrap ${c.outstanding > 0 ? 'text-amber-700 font-medium' : 'text-ink/50'}`}>
                      {c.outstanding > 0 ? c.outstanding.toFixed(3) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Revenue Trend (12 months, with YoY) */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
          <LineChartIcon size={15} />
          Revenue Trend — Last 12 Months
        </div>
        <p className="text-xs text-muted mb-2">Blue = Revenue, Amber = Expense. Number above each bar is Net Profit (OMR). % below is vs the same month last year.</p>
        {trend.length === 0 ? <div className="text-sm text-muted">Loading…</div> : <RevenueTrendChart months={trend} />}
      </Card>

      {/* Inventory Turnover / Slow-moving Stock */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
          <Boxes size={15} />
          Inventory Turnover — Last 90 Days
        </div>
        {!turnover ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Raw Materials</div>
              {slowMovingRaw.length === 0 ? (
                <EmptyState>No slow-moving raw materials.</EmptyState>
              ) : (
                <div className="divide-y divide-black/5">
                  {slowMovingRaw.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="text-ink font-medium">{r.name}</div>
                        <div className="text-xs text-amber-700">No usage in 90 days</div>
                      </div>
                      <div className="text-ink/70 text-right whitespace-nowrap">
                        {formatQuantityWithUnit(r.quantityInStock, r.unit)}
                        <div className="text-xs text-muted">{r.stockValue.toFixed(3)} OMR</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Finished Goods</div>
              {slowMovingFinished.length === 0 ? (
                <EmptyState>No slow-moving finished goods.</EmptyState>
              ) : (
                <div className="divide-y divide-black/5">
                  {slowMovingFinished.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="text-ink font-medium">{r.name}</div>
                        <div className="text-xs text-amber-700">No sales in 90 days</div>
                      </div>
                      <div className="text-ink/70 text-right whitespace-nowrap">
                        {formatQuantityWithUnit(r.quantityInStock, r.unit)}
                        <div className="text-xs text-muted">{r.stockValue.toFixed(3)} OMR</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
