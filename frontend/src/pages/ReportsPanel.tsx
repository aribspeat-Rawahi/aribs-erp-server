import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt,
  TrendingUp,
  PackageCheck,
  AlertTriangle,
  BarChart3,
  Users,
  Clock,
  Scale,
  BookOpen,
  Landmark,
  FileText,
  RotateCcw,
  ShoppingCart,
  Package,
  Boxes,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import api from '../api/client';
import { Card, StatCard, EmptyState, inputClass } from '../components/ui';
import { formatQuantity } from '../utils/formatQuantity';

// Reports Hub — one card per report, matching the reference design. Each
// card opens its own full page at /accounting/reports/:key (ReportDetail.tsx
// picks which report to render). Reports not built yet still get a working
// card — the detail page shows "coming soon" for those keys.
const REPORT_CARDS: { key: string; title: string; description: string; icon: any }[] = [
  { key: 'trial-balance', title: 'Trial Balance', description: "Every account's total debit/credit and net balance, all-time.", icon: Scale },
  { key: 'ledger-report', title: 'Ledger Report', description: 'Line-by-line transactions and running balance for one account.', icon: BookOpen },
  { key: 'income-statement', title: 'Income Statement', description: 'Revenue vs Expenses and Net Profit for a chosen date range.', icon: TrendingUp },
  { key: 'sales-tax', title: 'Sales Tax', description: 'Output VAT collected on invoices, by date range.', icon: Receipt },
  { key: 'balance-sheet', title: 'Balance Sheet', description: 'Assets, Liabilities and Equity as of a chosen date.', icon: Landmark },
  { key: 'purchase-vat', title: 'Purchase VAT', description: 'Input VAT paid on received purchase orders, by date range.', icon: FileText },
  { key: 'purchase-return', title: 'Purchase Return', description: 'Items returned to suppliers, with status and refunds.', icon: RotateCcw },
  { key: 'sales-return', title: 'Sales Return', description: 'Items returned by customers, with status and refunds.', icon: RotateCcw },
  { key: 'product-sales', title: 'Product Sales', description: 'Revenue broken down by product, by date range.', icon: ShoppingCart },
  { key: 'product-purchase', title: 'Product Purchase', description: 'Purchases broken down by raw material, by date range.', icon: Package },
  { key: 'inventory-report', title: 'Inventory Report', description: 'Current stock valuation for raw materials and finished goods.', icon: Boxes },
  { key: 'reimbursements', title: 'Reimbursements', description: 'Employee reimbursement claims and their status.', icon: Wallet },
];

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

interface TrendPoint {
  label: string;
  total: number;
  count: number;
}
interface CustomerBreakdown {
  customerId: string;
  customerName: string;
  total: number;
  count: number;
}
interface LowStockItem {
  id: string;
  name: string;
  quantityInStock: number;
  unit: string;
}
interface AgingRow {
  customerId: string;
  customerName: string;
  customerPhone?: string;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  totalOutstanding: number;
  oldestDaysOverdue: number;
}
interface AgingReport {
  asOfDate: string;
  rows: AgingRow[];
  grandTotal: Omit<AgingRow, 'customerId' | 'customerName' | 'customerPhone' | 'oldestDaysOverdue'>;
}

function MonthlyTrendChart({ data }: { data: TrendPoint[] }) {
  const max = Math.max(1, ...data.map((d) => Number(d.total)));
  return (
    <div className="flex items-end gap-3 h-40 px-2">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1.5">
          <div className="text-xs font-medium text-ink">{Number(d.total).toFixed(0)}</div>
          <div
            className="w-full bg-brand-500 rounded-t-md min-h-[2px]"
            style={{ height: `${Math.max(2, (Number(d.total) / max) * 100)}px` }}
          />
          <div className="text-xs text-muted">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// Reports content — moved out of the standalone Reports page into a panel
// rendered inside Accounting.tsx's "Reports" tab (Accounting is now the
// single left-menu destination for anything financial: Expenses,
// Reimbursements, Reports, Journals).
export default function ReportsPanel() {
  const [{ startDate, endDate }, setRange] = useState(monthRange());
  const [summary, setSummary] = useState<any>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [customerSales, setCustomerSales] = useState<CustomerBreakdown[]>([]);
  const [lowStock, setLowStock] = useState<{ rawMaterials: LowStockItem[]; finishedGoods: LowStockItem[] } | null>(null);
  const [aging, setAging] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/reports/summary', { params: { startDate, endDate } }),
      api.get('/reports/monthly-trend', { params: { months: 6 } }),
      api.get('/reports/customer-sales', { params: { startDate, endDate } }),
      api.get('/reports/low-stock'),
    ])
      .then(([s, t, c, l]) => {
        setSummary(s.data);
        setTrend(t.data);
        setCustomerSales(c.data);
        setLowStock(l.data);
      })
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  // Aging is "as of today", not tied to the chosen date range, so it's
  // loaded once on its own rather than re-fetched every time the range
  // picker above changes.
  useEffect(() => {
    api.get('/reports/aging').then((res) => setAging(res.data));
  }, []);

  const revenue = summary?.accounting?.revenue?.total ?? 0;
  const invoiceCount = summary?.accounting?.revenue?.count ?? 0;
  const netProfit = summary?.accounting?.netProfit ?? 0;
  const completedOrders = summary?.sales?.completedOrders ?? 0;
  const lowStockItems = [...(lowStock?.rawMaterials || []), ...(lowStock?.finishedGoods || [])];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Left column — the existing dashboard-style overview. */}
      <div className="lg:col-span-2">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Business Overview</div>
        <div className="flex items-center justify-end gap-2 mb-4">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
          />
          <span className="text-muted text-sm">to</span>
          <input
            type="date"
            className={inputClass}
            value={endDate}
            onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
          />
        </div>

        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
              <StatCard icon={Receipt} label="Revenue" value={`${Number(revenue).toFixed(3)} OMR`} sub={`${invoiceCount} invoices`} />
              <StatCard icon={TrendingUp} label="Net Profit" value={`${Number(netProfit).toFixed(3)} OMR`} />
              <StatCard icon={PackageCheck} label="Completed Sales Orders" value={String(completedOrders)} />
              <StatCard
                icon={AlertTriangle}
                label="Low Stock Alerts"
                value={String(lowStockItems.length)}
                tone={lowStockItems.length ? 'warn' : 'default'}
              />
            </div>

            <Card className="p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Clock size={15} />
                  Accounts Receivable Aging
                </div>
                {aging && <span className="text-xs text-muted">As of {aging.asOfDate}</span>}
              </div>
              {!aging ? (
                <div className="text-sm text-muted">Loading…</div>
              ) : aging.rows.length === 0 ? (
                <EmptyState>No outstanding customer balances — everything is paid up.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted border-b border-black/10">
                        <th className="py-2 pr-3 font-medium">Customer</th>
                        <th className="py-2 px-3 font-medium text-right">Current</th>
                        <th className="py-2 px-3 font-medium text-right">1-30 Days</th>
                        <th className="py-2 px-3 font-medium text-right">31-60 Days</th>
                        <th className="py-2 px-3 font-medium text-right">61-90 Days</th>
                        <th className="py-2 px-3 font-medium text-right">90+ Days</th>
                        <th className="py-2 pl-3 font-medium text-right">Total Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {aging.rows.map((r) => (
                        <tr key={r.customerId}>
                          <td className="py-2 pr-3">
                            <div className="text-ink font-medium">{r.customerName}</div>
                            {r.oldestDaysOverdue > 90 && (
                              <div className="text-xs text-red-600">{r.oldestDaysOverdue} days overdue</div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-ink/70">{Number(r.current) > 0 ? Number(r.current).toFixed(3) : '-'}</td>
                          <td className="py-2 px-3 text-right text-amber-700">{Number(r.days1to30) > 0 ? Number(r.days1to30).toFixed(3) : '-'}</td>
                          <td className="py-2 px-3 text-right text-amber-800">{Number(r.days31to60) > 0 ? Number(r.days31to60).toFixed(3) : '-'}</td>
                          <td className="py-2 px-3 text-right text-red-600">{Number(r.days61to90) > 0 ? Number(r.days61to90).toFixed(3) : '-'}</td>
                          <td className="py-2 px-3 text-right text-red-700 font-medium">{Number(r.days90plus) > 0 ? Number(r.days90plus).toFixed(3) : '-'}</td>
                          <td className="py-2 pl-3 text-right font-semibold text-ink">{Number(r.totalOutstanding).toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-black/10 font-semibold text-ink">
                        <td className="py-2 pr-3">Total</td>
                        <td className="py-2 px-3 text-right">{Number(aging.grandTotal.current).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">{Number(aging.grandTotal.days1to30).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">{Number(aging.grandTotal.days31to60).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">{Number(aging.grandTotal.days61to90).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">{Number(aging.grandTotal.days90plus).toFixed(3)}</td>
                        <td className="py-2 pl-3 text-right">{Number(aging.grandTotal.totalOutstanding).toFixed(3)} OMR</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-4 mb-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <BarChart3 size={15} />
                Monthly Revenue Trend
              </div>
              {trend.length === 0 ? <EmptyState>No invoice data yet.</EmptyState> : <MonthlyTrendChart data={trend} />}
            </Card>

            <Card className="p-4 mb-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <Users size={15} />
                Customer-wise Sales
              </div>
              {customerSales.length === 0 ? (
                <EmptyState>No sales in this range.</EmptyState>
              ) : (
                <div className="divide-y divide-black/5">
                  {customerSales.map((c) => (
                    <div key={c.customerId} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <div className="text-ink font-medium">{c.customerName}</div>
                        <div className="text-xs text-muted">{c.count} invoice(s)</div>
                      </div>
                      <div className="font-semibold text-ink">{Number(c.total).toFixed(3)} OMR</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 mb-3">
                <AlertTriangle size={15} />
                Low Stock Items
              </div>
              {lowStockItems.length === 0 ? (
                <EmptyState>All stock levels are healthy.</EmptyState>
              ) : (
                <div className="divide-y divide-black/5">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink">{item.name}</span>
                      <span className="text-amber-700 font-medium">
                        {formatQuantity(item.quantityInStock, item.unit)} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {/* Right column — the Reports Hub grid, stacked in this narrower column. */}
      <div className="lg:col-span-1">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">All Reports</div>
        <div className="grid grid-cols-1 gap-4">
          {REPORT_CARDS.map((r) => (
            <Card key={r.key} className="p-4 flex flex-col">
              <div className="flex items-start gap-3 mb-2">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
                  <r.icon size={17} />
                </div>
                <div className="text-sm font-semibold text-ink">{r.title}</div>
              </div>
              <p className="text-xs text-muted flex-1 mb-3">{r.description}</p>
              <Link
                to={`/accounting/reports/${r.key}`}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 border border-brand-200 hover:border-brand-300 rounded-lg px-3 py-1.5"
              >
                View Report
                <ArrowRight size={14} />
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
