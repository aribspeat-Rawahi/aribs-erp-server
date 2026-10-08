import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt,
  TrendingUp,
  TrendingDown,
  PackageCheck,
  AlertTriangle,
  BookOpen,
  ShoppingBag,
  FileText,
  Truck,
  Wallet,
  Landmark,
  Boxes,
  ShieldCheck,
  Repeat,
  Users,
  Bell,
  Plus,
  PackageX,
  PackageSearch,
  UserPlus,
  Building2,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, StatCard, Pill } from '../components/ui';
import { formatQuantityWithUnit } from '../utils/formatQuantity';
import { localISODate } from '../utils/dates';

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => localISODate(d);
  return { startDate: iso(start), endDate: iso(end) };
}

// Dashboard period selector — "This Month" / "Life Time" / a specific
// month-year (e.g. "May 2026") picked via a native <input type="month">.
type PeriodMode = 'this_month' | 'life_time' | 'custom';

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Earliest date any real business record could have — used as the
// "Life Time" range's startDate (backend endpoints already accept an
// arbitrary startDate/endDate, so no server change is needed).
const LIFE_TIME_START = '2000-01-01';

function monthYearRange(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const iso = (d: Date) => localISODate(d);
  return { startDate: iso(start), endDate: iso(end) };
}

function monthYearLabel(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function getPeriodRange(mode: PeriodMode, customMonth: string) {
  if (mode === 'life_time') return { startDate: LIFE_TIME_START, endDate: localISODate() };
  if (mode === 'custom') return monthYearRange(customMonth);
  return monthRange();
}

interface LowStockItem {
  id: string;
  name: string;
  quantityInStock: number;
  unit: string;
}

interface BankAccount {
  id: string;
  name: string;
  currentBalance: number;
}

interface TrendPoint {
  date: string;
  sales: number;
  expenses: number;
}

// CRM Step 9 — Combined Dashboard Alerts (GET /reports/alerts).
interface OverdueAlert {
  customerId: string;
  customerName: string;
  outstanding: number;
  oldestDaysOverdue: number;
}
interface CreditBreachAlert {
  customerId: string;
  customerName: string;
  creditLimit: number;
  outstanding: number;
  overBy: number;
}
interface StuckRecurringAlert {
  id: string;
  label: string;
  customerName: string;
  nextRunDate: string;
  daysStuck: number;
}
interface DashboardAlerts {
  overdueInvoices: { count: number; totalOutstanding: number; worst: OverdueAlert[] };
  creditLimitBreaches: CreditBreachAlert[];
  pendingApprovals: { count: number; items: any[] };
  stuckRecurringInvoices: StuckRecurringAlert[];
  lowStock: { count: number };
  pendingReimbursements: { count: number; totalAmount: number };
  totalAlertCount: number;
}

interface WalletSummary {
  balance: number;
  inflows: number;
  outflows: number;
}
interface InvoiceCard {
  totalInvoiced: number;
  totalCollected: number;
}
interface SalesCard {
  totalSales: number;
  returnAmount: number;
  cogs: number;
  grossProfit: number;
}
interface ExpenseBreakdownRow {
  category: string;
  amount: number;
}
interface ProductSummary {
  outOfStock: number;
  lowStockAlert: number;
  noSalesProducts: number;
  totalProducts: number;
}
interface DashboardCounts {
  customers: number;
  vendors: number;
  products: number;
}
interface OverdueInvoiceRow {
  id: string;
  invoiceNumber: string;
  customerName: string;
  dueDate: string;
  outstanding: number;
}
interface PayableBillRow {
  id: string;
  supplierName: string;
  total: number;
  paidAmount: number;
  due: number;
  receivedAt?: string;
}
interface CashBankAccountRow {
  accountId: string;
  accountName: string;
  type: 'cash' | 'bank';
  opening: number;
  in: number;
  out: number;
  closing: number;
}
interface DashboardExtra {
  wallet: WalletSummary;
  invoiceCard: InvoiceCard;
  salesCard: SalesCard;
  expenseBreakdown: ExpenseBreakdownRow[];
  productSummary: ProductSummary;
  counts: DashboardCounts;
  overdueInvoices: OverdueInvoiceRow[];
  payableBills: PayableBillRow[];
  cashBank: { cash: number; bank: number; accounts: { id: string; name: string; type: string; currentBalance: number }[] };
  cashBankActivity: CashBankAccountRow[];
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  utilities: 'Utilities',
  salary: 'Salary',
  raw_material: 'Raw Material',
  maintenance: 'Maintenance',
  transport: 'Transport',
  other: 'Other',
};

// Chart palette — Lime Green theme: Series 1-4 match the approved brand
// spec (lime, cyan, purple, amber), extended with a couple more distinct
// hues for categories beyond the first four.
const PIE_COLORS = ['#84cc16', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#14b8a6', '#eab308'];

function money(n: number) {
  return Number(n || 0).toFixed(3);
}

const quickActions = [
  { to: '/sales-orders', icon: ShoppingBag, label: 'Sales Orders' },
  { to: '/quotations', icon: FileText, label: 'Quotations' },
  { to: '/delivery-notes', icon: Truck, label: 'Delivery Notes' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/accounting', icon: Wallet, label: 'Accounting' },
  { to: '/inventory', icon: Boxes, label: 'Inventory' },
];

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [lowStock, setLowStock] = useState<{ rawMaterials: LowStockItem[]; finishedGoods: LowStockItem[] } | null>(null);
  const [bankAccounts, setBankAccounts] = useState<{ accounts: BankAccount[]; total: number } | null>(null);
  const [stockValue, setStockValue] = useState<{ value: number; productCount: number } | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlerts | null>(null);
  // next VAT return that is due (Accounting > Tax > VAT Returns)
  const { canAccessModule } = useAuth();
  const [vatDue, setVatDue] = useState<{ label: string; dueDate: string; daysToDue: number; overdue: boolean } | null>(null);
  const seesAccounting = canAccessModule('accounting');
  useEffect(() => {
    if (!seesAccounting) return;
    api
      .get('/vat-periods')
      .then((res) => setVatDue(res.data.nextDue))
      .catch(() => undefined);
  }, [seesAccounting]);
  const [extra, setExtra] = useState<DashboardExtra | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('area');
  const { startDate: defaultStart, endDate: defaultEnd } = monthRange();
  const [rangeStart, setRangeStart] = useState(defaultStart);
  const [rangeEnd, setRangeEnd] = useState(defaultEnd);

  // "This Month" / "Life Time" / a specific month-year — controls the
  // stat cards, My Wallets/Invoice/Sales cards, Expense Breakdown and
  // Product Summary (all fed by /reports/summary + /reports/dashboard-extra).
  // The daily-trend chart below keeps its own separate rangeStart/rangeEnd picker.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('this_month');
  const [customMonth, setCustomMonth] = useState(currentMonthValue());

  useEffect(() => {
    const { startDate, endDate } = getPeriodRange(periodMode, customMonth);
    Promise.all([
      api.get('/reports/summary', { params: { startDate, endDate } }),
      api.get('/reports/low-stock'),
      api.get('/reports/bank-accounts-overview'),
      api.get('/reports/stock-value'),
      api.get('/reports/alerts'),
      api.get('/reports/dashboard-extra', { params: { startDate, endDate } }),
    ])
      .then(([s, l, b, v, a, x]) => {
        setSummary(s.data);
        setLowStock(l.data);
        setBankAccounts(b.data);
        setStockValue(v.data);
        setAlerts(a.data);
        setExtra(x.data);
      })
      .finally(() => setLoading(false));
  }, [periodMode, customMonth]);

  useEffect(() => {
    api.get('/reports/daily-trend', { params: { startDate: rangeStart, endDate: rangeEnd } }).then((res) => setTrend(res.data));
  }, [rangeStart, rangeEnd]);

  if (loading) return <div className="text-sm text-muted">Loading…</div>;

  // From the ledger (same as the Income Statement): revenue excl. VAT,
  // expenses incl. cost of goods sold, salaries and depreciation.
  const revenue = summary?.accounting?.ledger?.revenue ?? 0;
  const invoiceCount = summary?.accounting?.revenue?.count ?? 0;
  const netProfit = summary?.accounting?.netProfit ?? 0;
  const expenses = summary?.accounting?.ledger?.expenses ?? 0;
  const completedOrders = summary?.sales?.completedOrders ?? 0;
  const lowStockItems = [...(lowStock?.rawMaterials || []), ...(lowStock?.finishedGoods || [])];

  const chartData = trend.map((t) => ({
    ...t,
    label: new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  }));

  const periodLabel = periodMode === 'this_month' ? 'this month' : periodMode === 'life_time' ? 'life time' : monthYearLabel(customMonth);
  const periodSubtitle =
    periodMode === 'this_month' ? 'This month at a glance' : periodMode === 'life_time' ? 'Life time — all-time overview' : `${monthYearLabel(customMonth)} at a glance`;

  const periodBtnBase = 'w-full sm:w-32 shrink-0 h-9 px-2 sm:px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors';

  const periodSelector = (
    <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:items-center sm:w-auto">
      <button
        type="button"
        onClick={() => setPeriodMode('this_month')}
        className={`${periodBtnBase} ${periodMode === 'this_month' ? 'bg-brand-500 text-ink' : 'bg-white border border-black/10 text-ink/70 hover:bg-black/5'}`}
      >
        This Month
      </button>
      <button
        type="button"
        onClick={() => setPeriodMode('life_time')}
        className={`${periodBtnBase} ${periodMode === 'life_time' ? 'bg-brand-500 text-ink' : 'bg-white border border-black/10 text-ink/70 hover:bg-black/5'}`}
      >
        Life Time
      </button>
      <input
        type="month"
        value={customMonth}
        onChange={(e) => {
          setCustomMonth(e.target.value);
          setPeriodMode('custom');
        }}
        className={`col-span-2 w-full sm:w-40 min-w-0 shrink-0 h-9 px-2 sm:px-3 rounded-lg text-sm border border-black/15 bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-500 ${
          periodMode === 'custom' ? 'ring-2 ring-brand-400/40 border-brand-500' : ''
        }`}
      />
    </div>
  );

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={periodSubtitle} action={periodSelector} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-4">
        <StatCard icon={Receipt} label={`Revenue (${periodLabel})`} value={`${Number(revenue).toFixed(3)} OMR`} sub={`excl. VAT · ${invoiceCount} invoices`} />
        <StatCard icon={TrendingUp} label="Net Profit" value={`${Number(netProfit).toFixed(3)} OMR`} sub={`Expenses: ${Number(expenses).toFixed(3)} OMR`} />
        <StatCard icon={PackageCheck} label="Completed Sales Orders" value={String(completedOrders)} sub={periodLabel} />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock Alerts"
          value={String(lowStockItems.length)}
          sub={lowStockItems.length ? 'needs attention' : 'all good'}
          tone={lowStockItems.length ? 'warn' : 'default'}
        />
      </div>

      {extra && (
        <>
          {/* My Wallets / Invoice / Sales */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 mb-4">
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <Wallet size={15} className="text-brand-600" />
                My Wallets
              </div>
              <div className="text-xl font-semibold text-ink mb-3">{money(extra.wallet.balance)} OMR</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <ArrowDownCircle size={16} className="text-brand-600" />
                  <div>
                    <div className="text-[11px] text-muted">Inflows</div>
                    <div className="text-sm font-medium text-ink">{money(extra.wallet.inflows)} OMR</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowUpCircle size={16} className="text-red-500" />
                  <div>
                    <div className="text-[11px] text-muted">Outflows</div>
                    <div className="text-sm font-medium text-ink">{money(extra.wallet.outflows)} OMR</div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <Receipt size={15} className="text-brand-600" />
                Invoice
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Total Invoiced</span>
                  <span className="font-medium text-ink">{money(extra.invoiceCard.totalInvoiced)} OMR</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Total Collected</span>
                  <span className="font-medium text-brand-700">{money(extra.invoiceCard.totalCollected)} OMR</span>
                </div>
              </div>
              <Link to="/invoices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Plus size={13} /> Create an invoice
              </Link>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <TrendingUp size={15} className="text-brand-600" />
                Sales
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Total Sales</span>
                  <span className="font-medium text-ink">{money(extra.salesCard.totalSales)} OMR</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Return Amount</span>
                  <span className="font-medium text-red-600">{money(extra.salesCard.returnAmount)} OMR</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">COGS</span>
                  <span className="font-medium text-ink">{money(extra.salesCard.cogs)} OMR</span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-black/5">
                  <span className="text-ink font-semibold">Gross Profit</span>
                  <span className="font-semibold text-brand-700">{money(extra.salesCard.grossProfit)} OMR</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Expense Breakdown / Product Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 mb-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <TrendingDown size={15} className="text-amber-600" />
                  Expense Breakdown
                </div>
                <div className="flex items-center gap-3">
                  <Link to="/accounting" className="text-xs font-medium text-brand-700 hover:underline">Add Expense</Link>
                  <Link to="/accounting" className="text-xs font-medium text-muted hover:underline">View All</Link>
                </div>
              </div>
              {extra.expenseBreakdown.length === 0 ? (
                <p className="text-sm text-muted">No expenses this month</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={extra.expenseBreakdown.map((r) => ({ name: EXPENSE_CATEGORY_LABELS[r.category] || r.category, value: r.amount }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {extra.expenseBreakdown.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(3)} OMR`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
                <PackageSearch size={15} className="text-brand-600" />
                Product Summary
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5">
                  <PackageX size={16} className={extra.productSummary.outOfStock ? 'text-red-600' : 'text-muted'} />
                  <div>
                    <div className="text-sm font-semibold text-ink">{extra.productSummary.outOfStock}</div>
                    <div className="text-[11px] text-muted">Out of Stock</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5">
                  <AlertTriangle size={16} className={extra.productSummary.lowStockAlert ? 'text-amber-600' : 'text-muted'} />
                  <div>
                    <div className="text-sm font-semibold text-ink">{extra.productSummary.lowStockAlert}</div>
                    <div className="text-[11px] text-muted">Low Stock Alert</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5">
                  <Boxes size={16} className="text-muted" />
                  <div>
                    <div className="text-sm font-semibold text-ink">{extra.productSummary.totalProducts}</div>
                    <div className="text-[11px] text-muted">Total Products</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5">
                  <PackageSearch size={16} className="text-muted" />
                  <div>
                    <div className="text-sm font-semibold text-ink">{extra.productSummary.noSalesProducts}</div>
                    <div className="text-[11px] text-muted">No Sales Products</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Customer / Vendor / Product counts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 mb-4">
            <Card className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Users size={17} className="text-brand-600" />
                <div>
                  <div className="text-lg font-semibold text-ink">{extra.counts.customers}</div>
                  <div className="text-xs text-muted">Customers</div>
                </div>
              </div>
              <Link to="/customers" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <UserPlus size={13} /> Create Customer
              </Link>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Truck size={17} className="text-brand-600" />
                <div>
                  <div className="text-lg font-semibold text-ink">{extra.counts.vendors}</div>
                  <div className="text-xs text-muted">Suppliers</div>
                </div>
              </div>
              <Link to="/suppliers?tab=suppliers" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Plus size={13} /> Create Supplier
              </Link>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Building2 size={17} className="text-brand-600" />
                <div>
                  <div className="text-lg font-semibold text-ink">{extra.counts.products}</div>
                  <div className="text-xs text-muted">Items</div>
                </div>
              </div>
              <Link to="/inventory" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Plus size={13} /> Create Product
              </Link>
            </Card>
          </div>

          {/* Overdue Invoices / Payable Bills */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 mb-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-ink">Overdue Invoices</div>
                <Link to="/invoices" className="text-xs font-medium text-muted hover:underline">View All</Link>
              </div>
              {extra.overdueInvoices.length === 0 ? (
                <p className="text-sm text-muted">No overdue invoices</p>
              ) : (
                <div className="divide-y divide-black/5">
                  {extra.overdueInvoices.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <div className="text-ink">{r.customerName}</div>
                        <div className="text-[11px] text-muted">{r.invoiceNumber} · Due {r.dueDate}</div>
                      </div>
                      <span className="font-medium text-red-600">{money(r.outstanding)} OMR</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-ink">Payable Bills</div>
                <Link to="/suppliers" className="text-xs font-medium text-muted hover:underline">View All</Link>
              </div>
              {extra.payableBills.length === 0 ? (
                <p className="text-sm text-muted">No payable bills</p>
              ) : (
                <>
                  <div className="divide-y divide-black/5">
                    {extra.payableBills.map((r) => (
                      <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-ink">{r.supplierName}</span>
                        <span className="font-medium text-ink">{money(r.due)} OMR</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-black/5 text-sm font-semibold">
                    <span className="text-ink">Total due</span>
                    <span className="text-ink">{money(extra.payableBills.reduce((s, r) => s + r.due, 0))} OMR</span>
                  </div>
                </>
              )}
              <p className="text-[11px] text-muted mt-2">
                Every RECEIVED purchase order with an outstanding balance — pay it down from Suppliers → Purchase Orders.
              </p>
            </Card>
          </div>

          {/* Cash & Bank */}
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Landmark size={15} className="text-brand-600" />
                Cash & Bank
              </div>
              <Link to="/accounting?tab=accounts" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Plus size={13} /> Create Account
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <div className="text-[11px] text-muted">Cash on Hand</div>
                <div className="text-lg font-semibold text-ink">{money(extra.cashBank.cash)} OMR</div>
              </div>
              <div>
                <div className="text-[11px] text-muted">Bank Balance</div>
                <div className="text-lg font-semibold text-ink">{money(extra.cashBank.bank)} OMR</div>
              </div>
            </div>
            {extra.cashBank.accounts.length > 0 && (
              <div className="divide-y divide-black/5 border-t border-black/5 pt-2">
                {extra.cashBank.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-ink">{a.name}</span>
                    <span className="font-medium text-ink">{money(a.currentBalance)} OMR</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Cash & Bank Activity */}
          <Card className="p-4 mb-4">
            <div className="text-sm font-semibold text-ink mb-3">Cash & Bank Activity</div>
            {extra.cashBankActivity.length === 0 ? (
              <p className="text-sm text-muted">No accounts yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] sm:min-w-0 text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-muted border-b border-black/10">
                      <th className="py-2 font-medium">Account</th>
                      <th className="py-2 font-medium text-right">Opening</th>
                      <th className="py-2 font-medium text-right">In</th>
                      <th className="py-2 font-medium text-right">Out</th>
                      <th className="py-2 font-medium text-right">Closing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {extra.cashBankActivity.map((a) => (
                      <tr key={a.accountId}>
                        <td className="py-2 text-ink">{a.accountName}</td>
                        <td className="py-2 text-right text-ink">{money(a.opening)}</td>
                        <td className="py-2 text-right text-brand-700">{money(a.in)}</td>
                        <td className="py-2 text-right text-red-600">{money(a.out)}</td>
                        <td className="py-2 text-right font-medium text-ink">{money(a.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {alerts && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Bell size={15} className="text-amber-600" />
              Alerts
            </div>
            {alerts.totalAlertCount === 0 ? (
              <span className="text-xs text-muted">All good</span>
            ) : (
              <span className="text-xs text-muted">{alerts.totalAlertCount} item(s) need attention</span>
            )}
          </div>

          {vatDue && (vatDue.overdue || vatDue.daysToDue <= 7) && (
            <Link
              to="/accounting?tab=tax"
              className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                vatDue.overdue ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              <AlertTriangle size={16} className="shrink-0" />
              <span>
                {vatDue.overdue
                  ? `${vatDue.label} return is overdue - it was due ${vatDue.dueDate}. File it with the OTA and mark it as filed.`
                  : `${vatDue.label} return is due ${vatDue.dueDate} (${vatDue.daysToDue} day(s) left).`}
              </span>
            </Link>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
            <Link
              to="/reports"
              className="rounded-lg border border-black/10 hover:border-brand-300 px-3 py-2.5 flex items-center gap-2.5"
            >
              <AlertTriangle size={16} className={alerts.overdueInvoices.count ? 'text-red-600' : 'text-muted'} />
              <div>
                <div className="text-sm font-semibold text-ink">{alerts.overdueInvoices.count}</div>
                <div className="text-[11px] text-muted">Overdue Invoices</div>
              </div>
            </Link>
            <Link
              to="/customers"
              className="rounded-lg border border-black/10 hover:border-brand-300 px-3 py-2.5 flex items-center gap-2.5"
            >
              <Users size={16} className={alerts.creditLimitBreaches.length ? 'text-red-600' : 'text-muted'} />
              <div>
                <div className="text-sm font-semibold text-ink">{alerts.creditLimitBreaches.length}</div>
                <div className="text-[11px] text-muted">Credit Limit Breach</div>
              </div>
            </Link>
            <Link
              to="/approvals"
              className="rounded-lg border border-black/10 hover:border-brand-300 px-3 py-2.5 flex items-center gap-2.5"
            >
              <ShieldCheck size={16} className={alerts.pendingApprovals.count ? 'text-amber-600' : 'text-muted'} />
              <div>
                <div className="text-sm font-semibold text-ink">{alerts.pendingApprovals.count}</div>
                <div className="text-[11px] text-muted">Pending Approvals</div>
              </div>
            </Link>
            <Link
              to="/recurring-invoices"
              className="rounded-lg border border-black/10 hover:border-brand-300 px-3 py-2.5 flex items-center gap-2.5"
            >
              <Repeat size={16} className={alerts.stuckRecurringInvoices.length ? 'text-red-600' : 'text-muted'} />
              <div>
                <div className="text-sm font-semibold text-ink">{alerts.stuckRecurringInvoices.length}</div>
                <div className="text-[11px] text-muted">Recurring Stuck</div>
              </div>
            </Link>
            <Link
              to="/accounting"
              className="rounded-lg border border-black/10 hover:border-brand-300 px-3 py-2.5 flex items-center gap-2.5"
            >
              <Wallet size={16} className={alerts.pendingReimbursements.count ? 'text-amber-600' : 'text-muted'} />
              <div>
                <div className="text-sm font-semibold text-ink">{alerts.pendingReimbursements.count}</div>
                <div className="text-[11px] text-muted">Reimbursements Pending</div>
              </div>
            </Link>
          </div>

          {(alerts.overdueInvoices.worst.length > 0 || alerts.creditLimitBreaches.length > 0 || alerts.stuckRecurringInvoices.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-3 border-t border-black/5">
              {alerts.overdueInvoices.worst.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-muted mb-1.5">Most overdue</div>
                  <div className="space-y-1">
                    {alerts.overdueInvoices.worst.slice(0, 3).map((o) => (
                      <div key={o.customerId} className="flex items-center justify-between text-xs">
                        <span className="text-ink truncate pr-2">{o.customerName}</span>
                        <span className="text-red-700 font-medium whitespace-nowrap">{o.oldestDaysOverdue}d</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {alerts.creditLimitBreaches.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-muted mb-1.5">Over credit limit</div>
                  <div className="space-y-1">
                    {alerts.creditLimitBreaches.slice(0, 3).map((c) => (
                      <div key={c.customerId} className="flex items-center justify-between text-xs">
                        <span className="text-ink truncate pr-2">{c.customerName}</span>
                        <span className="text-red-700 font-medium whitespace-nowrap">+{Number(c.overBy).toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {alerts.stuckRecurringInvoices.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-muted mb-1.5">Recurring invoices stuck</div>
                  <div className="space-y-1">
                    {alerts.stuckRecurringInvoices.slice(0, 3).map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs">
                        <span className="text-ink truncate pr-2">{r.label}</span>
                        <span className="text-red-700 font-medium whitespace-nowrap">{r.daysStuck}d</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-4 md:grid-cols-8 gap-3 mb-4">
        {quickActions.map((qa) => (
          <Link
            key={qa.to}
            to={qa.to}
            className="flex flex-col items-center gap-2 bg-white border border-black/10 rounded-xl py-4 hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
              <qa.icon size={17} />
            </div>
            <span className="text-xs font-medium text-ink/80 text-center px-1">{qa.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 mb-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">Sales & Expenses Overview</h3>
              <p className="text-xs text-muted">Daily trend for the selected range</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="min-w-0 flex-1 sm:flex-none text-xs border border-black/15 rounded-lg px-2 py-1.5"
                />
                <span className="text-xs text-muted">to</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="min-w-0 flex-1 sm:flex-none text-xs border border-black/15 rounded-lg px-2 py-1.5"
                />
              </div>
              <Pill
                options={[
                  { value: 'line', label: 'Line' },
                  { value: 'area', label: 'Area' },
                  { value: 'bar', label: 'Bar' },
                ]}
                value={chartType}
                onChange={(v) => setChartType(v as 'line' | 'area' | 'bar')}
              />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            {chartType === 'bar' ? (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(3)} OMR`} />
                <Bar dataKey="sales" fill="#84cc16" name="Sales" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" fill="#f59e0b" name="Expenses" radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : chartType === 'area' ? (
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(3)} OMR`} />
                <Area type="monotone" dataKey="sales" stroke="#84cc16" fill="#84cc1633" name="Sales" />
                <Area type="monotone" dataKey="expenses" stroke="#f59e0b" fill="#f59e0b33" name="Expenses" />
              </AreaChart>
            ) : (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(3)} OMR`} />
                <Line type="monotone" dataKey="sales" stroke="#84cc16" name="Sales" dot={false} />
                <Line type="monotone" dataKey="expenses" stroke="#f59e0b" name="Expenses" dot={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
              <AlertTriangle size={15} className="text-amber-600" />
              Low Stock Items
            </div>
            {lowStockItems.length === 0 ? (
              <p className="text-sm text-muted">No low stock items</p>
            ) : (
              <div className="divide-y divide-black/5">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{item.name}</span>
                    <span className="text-amber-700 font-medium">
                      {formatQuantityWithUnit(item.quantityInStock, item.unit)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
              <Landmark size={15} className="text-brand-600" />
              Bank Accounts
            </div>
            {!bankAccounts || bankAccounts.accounts.length === 0 ? (
              <p className="text-sm text-muted">No bank accounts added</p>
            ) : (
              <div className="divide-y divide-black/5">
                {bankAccounts.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{a.name}</span>
                    <span className="font-medium text-ink">{Number(a.currentBalance).toFixed(3)} OMR</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 text-sm font-semibold">
                  <span className="text-ink">Total</span>
                  <span className="text-brand-700">{Number(bankAccounts.total).toFixed(3)} OMR</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen size={16} className="text-brand-600" />
          Stock Value
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-ink">{Number(stockValue?.value ?? 0).toFixed(3)} OMR</div>
          <div className="text-xs text-muted">{stockValue?.productCount ?? 0} products in inventory</div>
        </div>
      </Card>
    </div>
  );
}
