import { ReactNode, useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer, Landmark, Receipt, Users, Tags } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, inputClass } from '../components/ui';
import { formatQuantityWithUnit } from '../utils/formatQuantity';
import { useAuth } from '../context/AuthContext';
import { localISODate } from '../utils/dates';

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => localISODate(d);
  return { startDate: iso(start), endDate: iso(end) };
}
function todayStr() {
  return localISODate();
}

const REPORT_TITLES: Record<string, string> = {
  'trial-balance': 'Trial Balance',
  'ledger-report': 'Ledger Report',
  'income-statement': 'Income Statement',
  'sales-tax': 'Sales Tax',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow Statement',
  'three-way-match': 'Three-way Match',
  'purchase-vat': 'Purchase VAT',
  'purchase-return': 'Purchase Return',
  'sales-return': 'Sales Return',
  'product-sales': 'Product Sales',
  'product-purchase': 'Product Purchase',
  'inventory-report': 'Inventory Report',
  'reimbursements': 'Reimbursements',
  'books-check': 'Books Health Check',
};

const BUILT_REPORTS = new Set([
  'trial-balance',
  'income-statement',
  'balance-sheet',
  'cash-flow',
  'three-way-match',
  'sales-tax',
  'purchase-vat',
  'reimbursements',
  'ledger-report',
  'purchase-return',
  'sales-return',
  'product-sales',
  'product-purchase',
  'inventory-report',
  'books-check',
]);

// One route (/accounting/reports/:reportKey) handles every Reports Hub
// card — the reportKey decides which section below renders.
export default function ReportDetail() {
  const { reportKey = '' } = useParams();
  const title = REPORT_TITLES[reportKey] || 'Report';

  return (
    <div>
      <PageHeader
        title={title}
        subtitle="Accounting Reports"
        action={
          <div className="print:hidden flex items-center gap-2">
            <Link
              to="/accounting?tab=reports"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink border border-black/10 rounded-lg px-3 py-1.5"
            >
              <ArrowLeft size={15} />
              Back to Report
            </Link>
            <Link
              to="/accounting"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink border border-black/10 rounded-lg px-3 py-1.5"
            >
              <ArrowLeft size={15} />
              Back to Accounting
            </Link>
          </div>
        }
      />
      {reportKey === 'trial-balance' && <TrialBalanceReport />}
      {reportKey === 'income-statement' && <IncomeStatementReport />}
      {reportKey === 'balance-sheet' && <BalanceSheetReport />}
      {reportKey === 'cash-flow' && <CashFlowReport />}
      {reportKey === 'three-way-match' && <ThreeWayMatchReport />}
      {reportKey === 'sales-tax' && <SalesTaxHub />}
      {reportKey === 'purchase-vat' && <PurchaseVatReport />}
      {reportKey === 'reimbursements' && <ReimbursementsReport />}
      {reportKey === 'ledger-report' && <LedgerReport />}
      {reportKey === 'purchase-return' && <PurchaseReturnReport />}
      {reportKey === 'sales-return' && <SalesReturnReport />}
      {reportKey === 'product-sales' && <ProductSalesReport />}
      {reportKey === 'product-purchase' && <ProductPurchaseReport />}
      {reportKey === 'inventory-report' && <InventoryReport />}
      {reportKey === 'books-check' && <BooksCheckReport />}
      {!BUILT_REPORTS.has(reportKey) && (
        <EmptyState>This report is coming soon.</EmptyState>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Shared building blocks — every report below is built from these three
// pieces so the whole Reports Hub reads as one consistent accounting
// system: a toolbar (filters + Print), a formal Account/Amount table
// with a "No items found" empty row and a bold Total row, and a Print
// button that triggers the browser's real print dialog (print:hidden
// hides the toolbar/nav/buttons so only the report table is printed).
// ---------------------------------------------------------------------

function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink border border-black/10 rounded-lg px-3 py-1.5"
    >
      <Printer size={15} />
      Print
    </button>
  );
}

interface Column {
  label: string;
  align?: 'left' | 'right';
}

function ReportTable({
  columns,
  isEmpty,
  emptyMessage,
  footer,
  children,
}: {
  columns: Column[];
  isEmpty: boolean;
  emptyMessage?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // On a phone, tables with 3+ columns keep a sensible minimum width and
  // scroll sideways instead of crushing each column to one word per line.
  const phoneMinWidth = isEmpty ? '' : columns.length > 6 ? 'min-w-[800px] sm:min-w-0' : columns.length > 2 ? 'min-w-[600px] sm:min-w-0' : '';
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm [&_td.text-right]:whitespace-nowrap ${phoneMinWidth}`}>
        <thead>
          <tr className="text-left text-xs text-muted border-b border-black/10 bg-black/[0.02]">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`py-2 ${i === 0 ? 'pl-3' : ''} px-3 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {isEmpty ? (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-muted">
                {emptyMessage || 'No items found.'}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
        {footer && !isEmpty && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-muted px-1 mb-1.5">{children}</div>;
}

function DateRangePicker({
  startDate,
  endDate,
  onChange,
  right,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <input type="date" className={inputClass} value={startDate} onChange={(e) => onChange({ startDate: e.target.value, endDate })} />
        <span className="text-muted text-sm">to</span>
        <input type="date" className={inputClass} value={endDate} onChange={(e) => onChange({ startDate, endDate: e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        {right}
        <PrintButton />
      </div>
    </div>
  );
}

function PeriodLine({ startDate, endDate }: { startDate: string; endDate: string }) {
  return <p className="text-xs text-muted mb-3">For the period of (Transaction date): {startDate} to {endDate}</p>;
}

const money = (n: number) => n.toFixed(3);

// ---------------------------------------------------------------------

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type?: string;
  debit: number;
  credit: number;
  balance: number;
}

function TrialBalanceReport() {
  const [data, setData] = useState<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean } | null>(null);

  useEffect(() => {
    api.get('/journal-entries/trial-balance').then((res) => setData(res.data));
  }, []);

  if (!data) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-sm text-muted">All-time balance per account, across every journal entry.</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${data.balanced ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
            {data.balanced ? 'Balanced' : 'Not balanced'}
          </span>
          <PrintButton />
        </div>
      </div>
      <ReportTable
        columns={[
          { label: 'Code' },
          { label: 'Account Name' },
          { label: 'Debit Total', align: 'right' },
          { label: 'Credit Total', align: 'right' },
          { label: 'Balance', align: 'right' },
        ]}
        isEmpty={data.rows.length === 0}
        emptyMessage="No journal activity yet."
        footer={
          <tr className="border-t border-black/10 font-semibold text-blue-700">
            <td colSpan={2} className="py-2 pl-3">Total</td>
            <td className="py-2 px-3 text-right">{money(data.totalDebit)}</td>
            <td className="py-2 px-3 text-right">{money(data.totalCredit)}</td>
            <td className="py-2 px-3 text-right">OMR</td>
          </tr>
        }
      >
        {data.rows.map((r) => (
          <tr key={r.accountId}>
            <td className="py-2 pl-3 text-muted">{r.code}</td>
            <td className="py-2 px-3 text-ink">{r.name}</td>
            <td className="py-2 px-3 text-right">{r.debit > 0 ? money(r.debit) : '-'}</td>
            <td className="py-2 px-3 text-right">{r.credit > 0 ? money(r.credit) : '-'}</td>
            <td className="py-2 px-3 text-right font-medium">{money(r.balance)}</td>
          </tr>
        ))}
      </ReportTable>
    </Card>
  );
}

interface IncomeStatementRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

function IncomeStatementReport() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{
    revenues: IncomeStatementRow[];
    totalRevenue: number;
    expenses: IncomeStatementRow[];
    totalExpense: number;
    netProfit: number;
  } | null>(null);

  useEffect(() => {
    api.get('/reports/income-statement', { params: range }).then((res) => setData(res.data));
  }, [range]);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />

          <SectionTitle>Income</SectionTitle>
          <ReportTable
            columns={[{ label: 'Account Name' }, { label: 'Amount', align: 'right' }]}
            isEmpty={data.revenues.length === 0}
            emptyMessage="No items found."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td className="py-2 pl-3">Total Income</td>
                <td className="py-2 px-3 text-right">{money(data.totalRevenue)}</td>
              </tr>
            }
          >
            {data.revenues.map((r) => (
              <tr key={r.accountId}>
                <td className="py-2 pl-3 text-ink">{r.name}</td>
                <td className="py-2 px-3 text-right">{money(r.amount)}</td>
              </tr>
            ))}
          </ReportTable>

          <div className="mt-5">
            <SectionTitle>Expense</SectionTitle>
            <ReportTable
              columns={[{ label: 'Account Name' }, { label: 'Amount', align: 'right' }]}
              isEmpty={data.expenses.length === 0}
              emptyMessage="No items found."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td className="py-2 pl-3">Total Expense</td>
                  <td className="py-2 px-3 text-right">{money(data.totalExpense)}</td>
                </tr>
              }
            >
              {data.expenses.map((r) => (
                <tr key={r.accountId}>
                  <td className="py-2 pl-3 text-ink">{r.name}</td>
                  <td className="py-2 px-3 text-right">{money(r.amount)}</td>
                </tr>
              ))}
            </ReportTable>
          </div>

          <div className={`flex items-center justify-between mt-4 pt-3 border-t-2 border-black/10 px-1 text-base font-semibold ${data.netProfit >= 0 ? 'text-brand-700' : 'text-red-600'}`}>
            <span>Profit</span>
            <span>{money(data.netProfit)} OMR</span>
          </div>
          <p className="text-xs text-muted mt-3">
            Based on Journal Entry postings (manual + auto-posted from Invoice/Expense/Reimbursement) whose date falls in this range.
          </p>
        </Card>
      )}
    </>
  );
}

interface CashFlowLine {
  accountId: string;
  code: string;
  name: string;
  inflow: number;
  outflow: number;
  net: number;
}
interface CashFlowData {
  openingCash: number;
  closingCash: number;
  netChange: number;
  sections: { operating: CashFlowLine[]; investing: CashFlowLine[]; financing: CashFlowLine[] };
  totals: { operating: number; investing: number; financing: number };
  checks: { ledgerClosingCash: number; matches: boolean };
}

const CASH_FLOW_SECTIONS: { key: 'operating' | 'investing' | 'financing'; title: string; hint: string }[] = [
  { key: 'operating', title: 'Operating activities', hint: 'sales, expenses, salaries, VAT, customers & suppliers' },
  { key: 'investing', title: 'Investing activities', hint: 'buying / selling long-term assets (machinery, vehicles, construction)' },
  { key: 'financing', title: 'Financing activities', hint: 'loans received / repaid, capital, drawings' },
];

// Statement of Cash Flows (direct method): every bank/cash movement in the
// period, grouped by what it was for.
function CashFlowReport() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<CashFlowData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api
      .get('/reports/cash-flow', { params: range })
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message || 'Could not load the cash flow.'));
  }, [range]);

  const signed = (n: number) => (n < 0 ? `(${money(-n)})` : money(n));

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : !data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <div className="flex items-center justify-between px-1 py-2 text-sm font-medium text-ink border-b border-black/10 mb-3">
            <span>Cash & bank at the start</span>
            <span>{money(data.openingCash)} OMR</span>
          </div>
          {CASH_FLOW_SECTIONS.map((s) => (
            <div key={s.key} className="mb-5">
              <SectionTitle>
                {s.title} <span className="normal-case font-normal tracking-normal">- {s.hint}</span>
              </SectionTitle>
              <ReportTable
                columns={[{ label: 'Account' }, { label: 'Money in', align: 'right' }, { label: 'Money out', align: 'right' }, { label: 'Net', align: 'right' }]}
                isEmpty={data.sections[s.key].length === 0}
                emptyMessage="No money moved for this."
                footer={
                  <tr className="border-t border-black/10 font-semibold text-blue-700">
                    <td className="py-2 pl-3" colSpan={3}>
                      Net cash from {s.title.toLowerCase()}
                    </td>
                    <td className="py-2 px-3 text-right">{signed(data.totals[s.key])}</td>
                  </tr>
                }
              >
                {data.sections[s.key].map((r) => (
                  <tr key={r.accountId}>
                    <td className="py-2 pl-3 text-ink">
                      <span className="text-muted">{r.code}</span> {r.name}
                    </td>
                    <td className="py-2 px-3 text-right">{r.inflow ? money(r.inflow) : '-'}</td>
                    <td className="py-2 px-3 text-right">{r.outflow ? money(r.outflow) : '-'}</td>
                    <td className="py-2 px-3 text-right">{signed(r.net)}</td>
                  </tr>
                ))}
              </ReportTable>
            </div>
          ))}
          <div className="flex items-center justify-between px-1 py-2 text-sm border-t border-black/10">
            <span className="text-ink">Net change in cash</span>
            <span className={data.netChange < 0 ? 'text-red-600 font-medium' : 'text-ink font-medium'}>{signed(data.netChange)} OMR</span>
          </div>
          <div className="flex items-center justify-between mt-1 pt-3 border-t-2 border-black/10 px-1 text-base font-semibold text-brand-700">
            <span>Cash & bank at the end</span>
            <span>{money(data.closingCash)} OMR</span>
          </div>
          <p className={`text-xs mt-3 ${data.checks.matches ? 'text-muted' : 'text-red-600'}`}>
            {data.checks.matches
              ? 'Matches the bank & cash accounts in the ledger on the end date. Moves between your own accounts are left out; opening balances count as the starting cash.'
              : `Does not match the ledger bank & cash balance on the end date (${money(data.checks.ledgerClosingCash)}) - run the Books Health Check.`}
          </p>
        </Card>
      )}
    </>
  );
}

interface ThreeWayRow {
  goodsReceiptId: string;
  grnNumber: string;
  receivedDate: string;
  poNumber: string;
  supplierName: string;
  orderedQty: number;
  receivedQty: number;
  orderTotal: number;
  grnTotal: number;
  supplierInvoiceNumber: string | null;
  supplierInvoiceTotal: number | null;
  difference: number | null;
  status: 'matched' | 'mismatch' | 'no_amount' | 'no_invoice';
}
const THREE_WAY_STATUS: Record<ThreeWayRow['status'], { label: string; cls: string }> = {
  matched: { label: 'Matched', cls: 'bg-green-50 text-green-700' },
  mismatch: { label: 'Amount differs', cls: 'bg-red-50 text-red-700' },
  no_amount: { label: 'Invoice total not entered', cls: 'bg-amber-50 text-amber-800' },
  no_invoice: { label: 'No supplier invoice', cls: 'bg-amber-50 text-amber-800' },
};

// Purchase order <-> goods received <-> supplier invoice, one row per delivery.
function ThreeWayMatchReport() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{ rows: ThreeWayRow[]; summary: { total: number; matched: number; mismatch: number; noAmount: number; noInvoice: number } } | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    api.get('/reports/three-way-match', { params: range }).then((res) => setData(res.data));
  }, [range]);

  const rows = (data?.rows || []).filter((r) => !onlyProblems || r.status !== 'matched');
  return (
    <>
      <DateRangePicker
        startDate={range.startDate}
        endDate={range.endDate}
        onChange={setRange}
        right={
          <label className="flex items-center gap-1.5 text-xs text-ink/80">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            Only problems
          </label>
        }
      />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <p className="text-xs text-muted mb-3">
            {data.summary.total} deliveries: {data.summary.matched} matched, {data.summary.mismatch} with a different invoice amount,{' '}
            {data.summary.noAmount} without the invoice total, {data.summary.noInvoice} without a supplier invoice.
          </p>
          <ReportTable
            columns={[
              { label: 'Delivery' },
              { label: 'Supplier / PO' },
              { label: 'Received / ordered qty', align: 'right' },
              { label: 'At PO prices', align: 'right' },
              { label: 'Supplier invoice', align: 'right' },
              { label: 'Difference', align: 'right' },
              { label: 'Status' },
            ]}
            isEmpty={rows.length === 0}
            emptyMessage={onlyProblems ? 'No problems in this period.' : 'No deliveries in this period.'}
          >
            {rows.map((r) => (
              <tr key={r.goodsReceiptId}>
                <td className="py-2 pl-3 text-ink whitespace-nowrap">
                  {r.grnNumber}
                  <div className="text-xs text-muted">{r.receivedDate}</div>
                </td>
                <td className="py-2 px-3">
                  {r.supplierName}
                  <div className="text-xs text-muted">{r.poNumber}</div>
                </td>
                <td className="py-2 px-3 text-right">
                  {r.receivedQty} / {r.orderedQty}
                </td>
                <td className="py-2 px-3 text-right">{money(r.grnTotal)}</td>
                <td className="py-2 px-3 text-right">
                  {r.supplierInvoiceTotal === null ? '-' : money(r.supplierInvoiceTotal)}
                  {r.supplierInvoiceNumber && <div className="text-xs text-muted">{r.supplierInvoiceNumber}</div>}
                </td>
                <td className={`py-2 px-3 text-right ${r.difference && Math.abs(r.difference) > 0.0005 ? 'text-red-600 font-medium' : ''}`}>
                  {r.difference === null ? '-' : money(r.difference)}
                </td>
                <td className="py-2 px-3">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${THREE_WAY_STATUS[r.status].cls}`}>
                    {THREE_WAY_STATUS[r.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </ReportTable>
          <p className="text-xs text-muted mt-3">
            "At PO prices" = what the delivered quantity is worth at the purchase order's prices incl. VAT - that is what was booked. A different
            supplier invoice amount is settled with a debit note / vendor credit (invoice lower) or by correcting the order (invoice higher).
          </p>
        </Card>
      )}
    </>
  );
}

function BalanceSheetReport() {
  const [asOfDate, setAsOfDate] = useState(todayStr());
  const [data, setData] = useState<{
    assets: IncomeStatementRow[];
    totalAssets: number;
    liabilities: IncomeStatementRow[];
    totalLiabilities: number;
    equity: IncomeStatementRow[];
    retainedEarnings: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    balanced: boolean;
  } | null>(null);

  useEffect(() => {
    api.get('/reports/balance-sheet', { params: { asOfDate } }).then((res) => setData(res.data));
  }, [asOfDate]);

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted whitespace-nowrap">As of</span>
          <input type="date" className={inputClass} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </div>
        <PrintButton />
      </div>
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs text-muted">For the period of (Transaction date): as of {asOfDate}</p>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${data.balanced ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
              {data.balanced ? 'Balanced' : 'Not balanced'}
            </span>
          </div>

          <SectionTitle>Assets</SectionTitle>
          <ReportTable
            columns={[{ label: 'Account Name' }, { label: 'Amount', align: 'right' }]}
            isEmpty={data.assets.length === 0}
            emptyMessage="No items found."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td className="py-2 pl-3">Total Asset</td>
                <td className="py-2 px-3 text-right">{money(data.totalAssets)}</td>
              </tr>
            }
          >
            {data.assets.map((r) => (
              <tr key={r.accountId}>
                <td className="py-2 pl-3 text-ink">{r.name}</td>
                <td className="py-2 px-3 text-right">{money(r.amount)}</td>
              </tr>
            ))}
          </ReportTable>

          <div className="mt-5">
            <SectionTitle>Liability</SectionTitle>
            <ReportTable
              columns={[{ label: 'Account Name' }, { label: 'Amount', align: 'right' }]}
              isEmpty={data.liabilities.length === 0}
              emptyMessage="No items found."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td className="py-2 pl-3">Total Liability</td>
                  <td className="py-2 px-3 text-right">{money(data.totalLiabilities)}</td>
                </tr>
              }
            >
              {data.liabilities.map((r) => (
                <tr key={r.accountId}>
                  <td className="py-2 pl-3 text-ink">{r.name}</td>
                  <td className="py-2 px-3 text-right">{money(r.amount)}</td>
                </tr>
              ))}
            </ReportTable>
          </div>

          <div className="mt-5">
            <SectionTitle>Equity</SectionTitle>
            <ReportTable
              columns={[{ label: 'Account Name' }, { label: 'Amount', align: 'right' }]}
              isEmpty={data.equity.length === 0 && data.retainedEarnings === 0}
              emptyMessage="No items found."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td className="py-2 pl-3">Total Equity</td>
                  <td className="py-2 px-3 text-right">{money(data.totalEquity)}</td>
                </tr>
              }
            >
              {data.equity.map((r) => (
                <tr key={r.accountId}>
                  <td className="py-2 pl-3 text-ink">{r.name}</td>
                  <td className="py-2 px-3 text-right">{money(r.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pl-3 text-ink">Retained Earnings (Net Income to Date)</td>
                <td className="py-2 px-3 text-right">{money(data.retainedEarnings)}</td>
              </tr>
            </ReportTable>
          </div>

          <div className="mt-5 pt-3 border-t border-black/10 space-y-1.5">
            <div className="flex items-center justify-between px-1 text-sm font-semibold text-brand-700">
              <span>Assets =</span>
              <span>{money(data.totalAssets)}</span>
            </div>
            <div className={`flex items-center justify-between px-1 text-sm font-semibold ${data.balanced ? 'text-brand-700' : 'text-red-600'}`}>
              <span>Liability + Equity =</span>
              <span>{money(data.totalLiabilitiesAndEquity)}</span>
            </div>
          </div>
          <p className="text-xs text-muted mt-3">
            This system has no year-end closing step, so accumulated Net Income since inception is shown as "Retained Earnings" to keep Assets = Liabilities + Equity. Balance Sheet is a point-in-time statement, so it is filtered by a single "as of" date rather than a range.
          </p>
        </Card>
      )}
    </>
  );
}

// -------------------------- Sales Tax --------------------------------

interface SalesTaxRow {
  id: string;
  type?: 'invoice' | 'credit_note' | 'asset_sale';
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  issueDate: string;
  subtotal: number;
  vatAmount: number;
  total: number;
}

const SALES_TAX_CARDS = [
  { key: 'agency', icon: Landmark, title: 'Agency Based', description: 'Net VAT payable to the Oman Tax Authority (OTA): output VAT − input VAT.' },
  { key: 'transaction', icon: Receipt, title: 'Transaction Based', description: 'Sales tax report broken down by individual invoice.' },
  { key: 'customer', icon: Users, title: 'Customer Based', description: 'Sales tax report grouped by customer.' },
  { key: 'category', icon: Tags, title: 'Category Based', description: 'Sales tax report grouped by VAT rate (Standard / Zero-rated).' },
];

function SalesTaxHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view');

  if (!view) {
    return (
      <div>
        <p className="text-sm text-muted mb-4">It generates sales tax reports for Oman VAT filing (OTA), grouped a few different ways.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SALES_TAX_CARDS.map((c) => (
            <Card key={c.key} className="p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-1.5">
                <c.icon size={17} className="text-brand-600" />
                <div className="font-semibold text-ink">{c.title}</div>
              </div>
              <p className="text-sm text-muted flex-1 mb-3">{c.description}</p>
              <button
                onClick={() => setSearchParams({ view: c.key })}
                className="self-start inline-flex items-center gap-1.5 text-sm font-medium text-ink bg-brand-500 hover:bg-brand-600 rounded-lg px-3 py-1.5"
              >
                View Report
              </button>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 print:hidden">
        <div className="text-base font-semibold text-ink">
          {SALES_TAX_CARDS.find((c) => c.key === view)?.title} Sales Tax Report
        </div>
        <button
          onClick={() => setSearchParams({})}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink border border-black/10 rounded-lg px-3 py-1.5"
        >
          <ArrowLeft size={15} />
          Back
        </button>
      </div>
      {view === 'agency' && <SalesTaxAgencyView />}
      {view === 'transaction' && <SalesTaxTransactionView />}
      {view === 'customer' && <SalesTaxCustomerView />}
      {view === 'category' && <SalesTaxCategoryView />}
    </div>
  );
}

// VAT return summary for the period: output VAT on sales (less credit
// notes) minus input VAT on purchases (less debit notes).
function SalesTaxAgencyView() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{
    taxableSales: number;
    outputVat: number;
    creditNotesVat: number;
    taxablePurchases: number;
    inputVat: number;
    debitNotesVat: number;
    netVatPayable: number;
    purchaseRowsMissingDocuments: number;
  } | null>(null);

  useEffect(() => {
    api.get('/reports/vat-summary', { params: range }).then((res) => setData(res.data));
  }, [range]);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <p className="text-xs text-muted mb-3">
            Oman Tax Authority (OTA). Sales are after discounts and less credit notes; purchases are goods received (with the supplier's tax invoice) less debit notes.
          </p>
          {/* Only three lines, so a plain table that wraps (no sideways scroll on a phone). */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-black/10 bg-black/[0.02]">
                  <th className="py-2 pl-3 font-medium">VAT return line</th>
                  <th className="py-2 px-3 font-medium text-right">Taxable value</th>
                  <th className="py-2 px-3 font-medium text-right">VAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                <tr>
                  <td className="py-2 pl-3 text-ink">
                    Output VAT — sales
                    {data.creditNotesVat ? <div className="text-xs text-muted">after {money(data.creditNotesVat)} credit notes</div> : null}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{money(data.taxableSales)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{money(data.outputVat)}</td>
                </tr>
                <tr>
                  <td className="py-2 pl-3 text-ink">
                    Input VAT — purchases
                    {data.debitNotesVat ? <div className="text-xs text-muted">after {money(data.debitNotesVat)} debit notes</div> : null}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{money(data.taxablePurchases)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">− {money(data.inputVat)}</td>
                </tr>
                <tr className="border-t border-black/10 font-semibold">
                  <td className="py-2 pl-3 text-ink">{data.netVatPayable >= 0 ? 'Net VAT payable to OTA' : 'Net VAT refundable from OTA'}</td>
                  <td className="py-2 px-3"></td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${data.netVatPayable >= 0 ? 'text-red-600' : 'text-brand-700'}`}>
                    {money(Math.abs(data.netVatPayable))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {data.purchaseRowsMissingDocuments > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              {data.purchaseRowsMissingDocuments} purchase(s) with VAT are missing the supplier's VATIN or tax invoice number — input VAT on those may not be claimable. See the Purchase VAT report.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function SalesTaxTransactionView() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{ rows: SalesTaxRow[]; totalTaxableSales: number; totalVat: number; invoiceCount: number } | null>(null);

  useEffect(() => {
    api.get('/reports/sales-tax', { params: range }).then((res) => setData(res.data));
  }, [range]);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <ReportTable
            columns={[
              { label: 'Invoice' },
              { label: 'Customer' },
              { label: 'Date' },
              { label: 'Taxable', align: 'right' },
              { label: 'VAT', align: 'right' },
              { label: 'Total', align: 'right' },
            ]}
            isEmpty={data.rows.length === 0}
            emptyMessage="No invoices in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td colSpan={3} className="py-2 pl-3">Total ({data.invoiceCount} invoices)</td>
                <td className="py-2 px-3 text-right">{money(data.totalTaxableSales)}</td>
                <td className="py-2 px-3 text-right">{money(data.totalVat)}</td>
                <td className="py-2 px-3 text-right"></td>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pl-3 text-ink whitespace-nowrap">{r.invoiceNumber}</td>
                <td className="py-2 px-3 text-ink">{r.customerName}</td>
                <td className="py-2 px-3 text-muted whitespace-nowrap">{r.issueDate}</td>
                <td className="py-2 px-3 text-right">{money(r.subtotal)}</td>
                <td className="py-2 px-3 text-right">{money(r.vatAmount)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(r.total)}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

function SalesTaxCustomerView() {
  const [range, setRange] = useState(monthRange());
  const [rows, setRows] = useState<SalesTaxRow[] | null>(null);

  useEffect(() => {
    api.get('/reports/sales-tax', { params: range }).then((res) => setRows(res.data.rows));
  }, [range]);

  const grouped = (rows || []).reduce((acc, r) => {
    // fixed assets sold have a buyer name, not a customer record
    const key = r.customerId || `asset:${r.customerName}`;
    const g = acc.get(key) || { customerName: r.customerName, taxable: 0, vat: 0, total: 0, invoices: 0 };
    g.taxable += r.subtotal;
    g.vat += r.vatAmount;
    g.total += r.total;
    if (r.type !== 'credit_note') g.invoices += 1;
    acc.set(key, g);
    return acc;
  }, new Map<string, { customerName: string; taxable: number; vat: number; total: number; invoices: number }>());
  const customerRows = Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  const totals = customerRows.reduce(
    (s, r) => ({ taxable: s.taxable + r.taxable, vat: s.vat + r.vat, total: s.total + r.total }),
    { taxable: 0, vat: 0, total: 0 },
  );

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!rows ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <ReportTable
            columns={[
              { label: 'Customer' },
              { label: 'Invoices', align: 'right' },
              { label: 'Taxable', align: 'right' },
              { label: 'VAT', align: 'right' },
              { label: 'Total', align: 'right' },
            ]}
            isEmpty={customerRows.length === 0}
            emptyMessage="No invoices in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td className="py-2 pl-3">Total</td>
                <td className="py-2 px-3 text-right">{customerRows.reduce((s, r) => s + r.invoices, 0)}</td>
                <td className="py-2 px-3 text-right">{money(totals.taxable)}</td>
                <td className="py-2 px-3 text-right">{money(totals.vat)}</td>
                <td className="py-2 px-3 text-right">{money(totals.total)}</td>
              </tr>
            }
          >
            {customerRows.map((r, i) => (
              <tr key={i}>
                <td className="py-2 pl-3 text-ink">{r.customerName}</td>
                <td className="py-2 px-3 text-right">{r.invoices}</td>
                <td className="py-2 px-3 text-right">{money(r.taxable)}</td>
                <td className="py-2 px-3 text-right">{money(r.vat)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(r.total)}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

interface VatRateRow {
  vatRate: number;
  label: string;
  taxableAmount: number;
  vatAmount: number;
}

function SalesTaxCategoryView() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{ rows: VatRateRow[]; totalTaxableSales: number; totalVat: number } | null>(null);

  useEffect(() => {
    api.get('/reports/sales-tax/by-rate', { params: range }).then((res) => setData(res.data));
  }, [range]);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <p className="text-xs text-muted mb-3">
            Grouped by VAT rate (Standard 5% / Zero-rated / Exempt) — the accounting-relevant "category" for an Oman VAT return, since this system has a single product line rather than product categories.
          </p>
          <ReportTable
            columns={[{ label: 'Category (VAT Rate)' }, { label: 'Taxable Amount', align: 'right' }, { label: 'VAT Amount', align: 'right' }]}
            isEmpty={data.rows.length === 0}
            emptyMessage="No invoices in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td className="py-2 pl-3">Total</td>
                <td className="py-2 px-3 text-right">{money(data.totalTaxableSales)}</td>
                <td className="py-2 px-3 text-right">{money(data.totalVat)}</td>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.vatRate}>
                <td className="py-2 pl-3 text-ink">{r.label}</td>
                <td className="py-2 px-3 text-right">{money(r.taxableAmount)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(r.vatAmount)}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

// ------------------------- Purchase VAT -------------------------------

interface PurchaseVatRow {
  id: string;
  type?: 'goods_receipt' | 'debit_note' | 'fixed_asset' | 'vendor_credit';
  reference?: string;
  poNumber?: string;
  supplierId: string;
  supplierName: string;
  supplierVatin?: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  receivedAt: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  missing?: string[];
}

// Input VAT per goods receipt (less debit notes), with what is needed to
// claim it: the supplier's VATIN and tax invoice number.
function PurchaseVatReport() {
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{ rows: PurchaseVatRow[]; totalTaxablePurchases: number; totalVat: number; orderCount: number; rowsMissingDocuments?: number } | null>(null);

  useEffect(() => {
    api.get('/reports/purchase-vat', { params: range }).then((res) => setData(res.data));
  }, [range]);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          {!!data.rowsMissingDocuments && (
            <p className="mb-3 text-xs text-amber-700">
              {data.rowsMissingDocuments} row(s) are missing the supplier's VATIN or tax invoice number — add them (Suppliers) so the input VAT can be claimed.
            </p>
          )}
          <ReportTable
            columns={[
              { label: 'Reference' },
              { label: 'Supplier' },
              { label: 'Supplier VATIN' },
              { label: 'Supplier invoice' },
              { label: 'Date' },
              { label: 'Taxable', align: 'right' },
              { label: 'VAT', align: 'right' },
              { label: 'Total', align: 'right' },
            ]}
            isEmpty={data.rows.length === 0}
            emptyMessage="No goods received in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td colSpan={5} className="py-2 pl-3">Total ({data.orderCount} goods receipts, net of debit notes)</td>
                <td className="py-2 px-3 text-right">{money(data.totalTaxablePurchases)}</td>
                <td className="py-2 px-3 text-right">{money(data.totalVat)}</td>
                <td className="py-2 px-3 text-right"></td>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.id} className={r.missing?.length ? 'bg-amber-50/60' : ''}>
                <td className="py-2 pl-3 text-ink whitespace-nowrap">
                  {r.reference || '-'}
                  {r.type === 'debit_note' ? ' (debit note)' : r.type === 'fixed_asset' ? ' (fixed asset)' : r.type === 'vendor_credit' ? ' (supplier credit note)' : ''}
                  {r.poNumber ? <div className="text-xs text-muted">{r.poNumber}</div> : null}
                </td>
                <td className="py-2 px-3 text-ink">{r.supplierName}</td>
                <td className="py-2 px-3 text-muted whitespace-nowrap">{r.supplierVatin || (r.missing?.includes('supplier VATIN') ? <span className="text-amber-700">missing</span> : '-')}</td>
                <td className="py-2 px-3 text-muted whitespace-nowrap">
                  {r.supplierInvoiceNumber || (r.missing?.includes('tax invoice no.') ? <span className="text-amber-700">missing</span> : '-')}
                  {r.supplierInvoiceDate ? <div className="text-xs">{r.supplierInvoiceDate}</div> : null}
                </td>
                <td className="py-2 px-3 text-muted whitespace-nowrap">{r.receivedAt}</td>
                <td className="py-2 px-3 text-right">{money(r.subtotal)}</td>
                <td className="py-2 px-3 text-right">{money(r.vatAmount)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(r.total)}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

// ------------------------ Reimbursements -------------------------------

interface ReimbursementRow {
  id: string;
  claimNumber: string;
  employeeId: string;
  category: string;
  amount: number | string;
  date: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
}

const reimbursementStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  paid: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

// Reuses the existing /reimbursements endpoint (already has everything
// this report needs) and filters/breaks it down client-side, rather than
// duplicating that data on the backend.
function ReimbursementsReport() {
  const [range, setRange] = useState(monthRange());
  const [all, setAll] = useState<ReimbursementRow[] | null>(null);

  useEffect(() => {
    api.get('/reimbursements').then((res) => setAll(res.data));
  }, []);

  const rows = (all || []).filter((r) => r.date >= range.startDate && r.date <= range.endDate);
  const totalsByStatus = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + Number(r.amount);
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalPaid = totalsByStatus['paid'] || 0;
  const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!all ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Card className="p-4">
              <div className="text-xs text-muted">Claims in Range</div>
              <div className="text-lg font-semibold text-ink">{rows.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Paid</div>
              <div className="text-lg font-semibold text-brand-700">{money(totalPaid)} OMR</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Pending</div>
              <div className="text-lg font-semibold text-amber-700">{money(totalsByStatus['pending'] || 0)} OMR</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Approved (unpaid)</div>
              <div className="text-lg font-semibold text-ink">{money(totalsByStatus['approved'] || 0)} OMR</div>
            </Card>
          </div>
          <Card className="p-4">
            <PeriodLine startDate={range.startDate} endDate={range.endDate} />
            <ReportTable
              columns={[
                { label: 'Claim #' },
                { label: 'Date' },
                { label: 'Category' },
                { label: 'Amount', align: 'right' },
                { label: 'Status', align: 'right' },
              ]}
              isEmpty={rows.length === 0}
              emptyMessage="No reimbursement claims in this range."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td colSpan={3} className="py-2 pl-3">Total</td>
                  <td className="py-2 px-3 text-right">{money(grandTotal)}</td>
                  <td className="py-2 px-3 text-right"></td>
                </tr>
              }
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pl-3 text-ink font-medium whitespace-nowrap">{r.claimNumber}</td>
                  <td className="py-2 px-3 text-muted whitespace-nowrap">{r.date}</td>
                  <td className="py-2 px-3 text-ink capitalize">{r.category.replace('_', ' ')}</td>
                  <td className="py-2 px-3 text-right font-medium">{money(Number(r.amount))}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reimbursementStatusTone[r.status]}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </ReportTable>
          </Card>
        </>
      )}
    </>
  );
}

// -------------------------- Ledger Report -------------------------------

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type?: string;
}
interface LedgerRow {
  date: string;
  createdAt: string;
  entryNumber: string;
  memo: string;
  debit: number;
  credit: number;
  balance: number;
}

function LedgerReport() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<{ account: AccountOption; openingBalance: number; rows: LedgerRow[]; closingBalance: number } | null>(null);

  useEffect(() => {
    api.get('/accounts').then((res) => {
      setAccounts(res.data);
      if (res.data.length > 0) setAccountId((prev) => prev || res.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setData(null);
    api.get(`/journal-entries/ledger/${accountId}`, { params: range }).then((res) => setData(res.data));
  }, [accountId, range]);

  const totalDebit = (data?.rows || []).reduce((s, r) => s + r.debit, 0);
  const totalCredit = (data?.rows || []).reduce((s, r) => s + r.credit, 0);

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input type="date" className={inputClass} value={range.startDate} onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))} />
            <span className="text-muted text-sm">to</span>
            <input type="date" className={inputClass} value={range.endDate} onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))} />
          </div>
        </div>
        <PrintButton />
      </div>
      {!data ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-4">
            <div><span className="text-muted">Account No:</span> <span className="font-medium text-ink">{data.account.code}</span></div>
            <div><span className="text-muted">Account Name:</span> <span className="font-medium text-ink">{data.account.name}</span></div>
            <div><span className="text-muted">Currency:</span> <span className="font-medium text-ink">OMR</span></div>
            <div><span className="text-muted">Period:</span> <span className="font-medium text-ink">{range.startDate} to {range.endDate}</span></div>
          </div>
          <ReportTable
            columns={[
              { label: 'Trns Date' },
              { label: 'Created At' },
              { label: 'Trns No' },
              { label: 'Particulars' },
              { label: 'Debit', align: 'right' },
              { label: 'Credit', align: 'right' },
              { label: 'Balance', align: 'right' },
            ]}
            isEmpty={false}
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td colSpan={4} className="py-2 pl-3">Total</td>
                <td className="py-2 px-3 text-right">{money(totalDebit)}</td>
                <td className="py-2 px-3 text-right">{money(totalCredit)}</td>
                <td className="py-2 px-3 text-right">{money(data.closingBalance)}</td>
              </tr>
            }
          >
            <tr>
              <td className="py-2 pl-3 text-muted whitespace-nowrap">{range.startDate}</td>
              <td className="py-2 px-3 text-muted">-</td>
              <td className="py-2 px-3 text-muted">-</td>
              <td className="py-2 px-3 text-ink italic">Opening Balance =</td>
              <td className="py-2 px-3 text-right">{money(0)}</td>
              <td className="py-2 px-3 text-right">{money(0)}</td>
              <td className="py-2 px-3 text-right font-medium">{money(data.openingBalance)}</td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="py-2 pl-3 text-muted whitespace-nowrap">{r.date}</td>
                <td className="py-2 px-3 text-muted">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="py-2 px-3 text-ink whitespace-nowrap">{r.entryNumber}</td>
                <td className="py-2 px-3 text-ink">{r.memo}</td>
                <td className="py-2 px-3 text-right">{r.debit > 0 ? money(r.debit) : '-'}</td>
                <td className="py-2 px-3 text-right">{r.credit > 0 ? money(r.credit) : '-'}</td>
                <td className="py-2 px-3 text-right font-medium">{money(r.balance)}</td>
              </tr>
            ))}
          </ReportTable>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/10 px-1 text-sm font-semibold text-ink">
            <span>Closing Balance</span>
            <span>{money(data.closingBalance)} OMR</span>
          </div>
        </Card>
      )}
    </>
  );
}

// --------------------- Purchase / Sales Return --------------------------

interface ReturnRow {
  id: string;
  returnNumber: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
  total: number | string;
  reason?: string;
}

const returnStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

// Reuses the existing /purchase-returns endpoint and filters client-side
// by date range — same pattern as the Reimbursements report.
function PurchaseReturnReport() {
  const [range, setRange] = useState(monthRange());
  const [all, setAll] = useState<(ReturnRow & { supplierId: string })[] | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api.get('/purchase-returns').then((res) => setAll(res.data));
    api.get('/suppliers').then((res) => setSuppliers(res.data));
  }, []);

  function supplierName(id: string) {
    return suppliers.find((s) => s.id === id)?.name || id;
  }

  const rows = (all || []).filter((r) => r.date >= range.startDate && r.date <= range.endDate);
  const totalsByStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + Number(r.total);
    return acc;
  }, {} as Record<string, number>);
  const grandTotal = rows.reduce((s, r) => s + Number(r.total), 0);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!all ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <Card className="p-4">
              <div className="text-xs text-muted">Returns in Range</div>
              <div className="text-lg font-semibold text-ink">{rows.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Approved</div>
              <div className="text-lg font-semibold text-brand-700">{money(totalsByStatus['approved'] || 0)} OMR</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Pending</div>
              <div className="text-lg font-semibold text-amber-700">{money(totalsByStatus['pending'] || 0)} OMR</div>
            </Card>
          </div>
          <Card className="p-4">
            <PeriodLine startDate={range.startDate} endDate={range.endDate} />
            <ReportTable
              columns={[
                { label: 'Supplier' },
                { label: 'Return #' },
                { label: 'Date' },
                { label: 'Reason' },
                { label: 'Amount', align: 'right' },
                { label: 'Status', align: 'right' },
              ]}
              isEmpty={rows.length === 0}
              emptyMessage="No purchase returns in this range."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td colSpan={4} className="py-2 pl-3">Total</td>
                  <td className="py-2 px-3 text-right">{money(grandTotal)}</td>
                  <td className="py-2 px-3 text-right"></td>
                </tr>
              }
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pl-3 text-ink font-medium">{supplierName(r.supplierId)}</td>
                  <td className="py-2 px-3 text-ink whitespace-nowrap">{r.returnNumber}</td>
                  <td className="py-2 px-3 text-muted whitespace-nowrap">{r.date}</td>
                  <td className="py-2 px-3 text-muted">{r.reason || '-'}</td>
                  <td className="py-2 px-3 text-right font-medium">{money(Number(r.total))}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${returnStatusTone[r.status]}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </ReportTable>
          </Card>
        </>
      )}
    </>
  );
}

// Same idea as PurchaseReturnReport, against /sales-returns + /customers.
function SalesReturnReport() {
  const [range, setRange] = useState(monthRange());
  const [all, setAll] = useState<(ReturnRow & { customerId: string })[] | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api.get('/sales-returns').then((res) => setAll(res.data));
    api.get('/customers').then((res) => setCustomers(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  const rows = (all || []).filter((r) => r.date >= range.startDate && r.date <= range.endDate);
  const totalsByStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + Number(r.total);
    return acc;
  }, {} as Record<string, number>);
  const grandTotal = rows.reduce((s, r) => s + Number(r.total), 0);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!all ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <Card className="p-4">
              <div className="text-xs text-muted">Returns in Range</div>
              <div className="text-lg font-semibold text-ink">{rows.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Approved</div>
              <div className="text-lg font-semibold text-brand-700">{money(totalsByStatus['approved'] || 0)} OMR</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Pending</div>
              <div className="text-lg font-semibold text-amber-700">{money(totalsByStatus['pending'] || 0)} OMR</div>
            </Card>
          </div>
          <Card className="p-4">
            <PeriodLine startDate={range.startDate} endDate={range.endDate} />
            <ReportTable
              columns={[
                { label: 'Customer' },
                { label: 'Return #' },
                { label: 'Date' },
                { label: 'Reason' },
                { label: 'Amount', align: 'right' },
                { label: 'Status', align: 'right' },
              ]}
              isEmpty={rows.length === 0}
              emptyMessage="No sales returns in this range."
              footer={
                <tr className="border-t border-black/10 font-semibold text-blue-700">
                  <td colSpan={4} className="py-2 pl-3">Total</td>
                  <td className="py-2 px-3 text-right">{money(grandTotal)}</td>
                  <td className="py-2 px-3 text-right"></td>
                </tr>
              }
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pl-3 text-ink font-medium">{customerName(r.customerId)}</td>
                  <td className="py-2 px-3 text-ink whitespace-nowrap">{r.returnNumber}</td>
                  <td className="py-2 px-3 text-muted whitespace-nowrap">{r.date}</td>
                  <td className="py-2 px-3 text-muted">{r.reason || '-'}</td>
                  <td className="py-2 px-3 text-right font-medium">{money(Number(r.total))}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${returnStatusTone[r.status]}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </ReportTable>
          </Card>
        </>
      )}
    </>
  );
}

// ----------------------- Product Sales / Purchase ------------------------

interface ProductSalesRow {
  finishedGoodId: string | null;
  description: string;
  productName: string;
  quantity: number;
  total: number;
}

function ProductSalesReport() {
  const [range, setRange] = useState(monthRange());
  const [rows, setRows] = useState<ProductSalesRow[] | null>(null);
  // Product sales rows carry no unit - take it from the product.
  const [productUnits, setProductUnits] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get('/reports/product-sales', { params: range }).then((res) => setRows(res.data));
  }, [range]);

  useEffect(() => {
    api.get('/finished-goods').then((res) => {
      const map: Record<string, string> = {};
      for (const f of res.data as { id: string; unit: string }[]) map[f.id] = f.unit;
      setProductUnits(map);
    });
  }, []);

  // A custom line (no product) has no unit - plain number.
  function quantityLabel(r: ProductSalesRow) {
    const unit = r.finishedGoodId ? productUnits[r.finishedGoodId] : undefined;
    return unit ? formatQuantityWithUnit(r.quantity, unit) : String(Math.round(Number(r.quantity) * 1000) / 1000);
  }

  const total = (rows || []).reduce((sum, r) => sum + Number(r.total), 0);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!rows ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <ReportTable
            columns={[{ label: 'Product' }, { label: 'Qty Sold', align: 'right' }, { label: 'Amount', align: 'right' }]}
            isEmpty={rows.length === 0}
            emptyMessage="No sales in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td colSpan={2} className="py-2 pl-3">Total</td>
                <td className="py-2 px-3 text-right">{money(total)}</td>
              </tr>
            }
          >
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="py-2 pl-3 text-ink">{r.productName}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{quantityLabel(r)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(Number(r.total))}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

interface ProductPurchaseRow {
  rawMaterialId: string;
  materialName: string;
  unit?: string;
  quantity: number;
  total: number;
}

function ProductPurchaseReport() {
  const [range, setRange] = useState(monthRange());
  const [rows, setRows] = useState<ProductPurchaseRow[] | null>(null);

  useEffect(() => {
    api.get('/reports/product-purchase', { params: range }).then((res) => setRows(res.data));
  }, [range]);

  const total = (rows || []).reduce((sum, r) => sum + Number(r.total), 0);

  return (
    <>
      <DateRangePicker startDate={range.startDate} endDate={range.endDate} onChange={setRange} />
      {!rows ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <Card className="p-4">
          <PeriodLine startDate={range.startDate} endDate={range.endDate} />
          <ReportTable
            columns={[{ label: 'Material' }, { label: 'Qty Purchased', align: 'right' }, { label: 'Amount', align: 'right' }]}
            isEmpty={rows.length === 0}
            emptyMessage="No received purchase orders in this range."
            footer={
              <tr className="border-t border-black/10 font-semibold text-blue-700">
                <td colSpan={2} className="py-2 pl-3">Total</td>
                <td className="py-2 px-3 text-right">{money(total)}</td>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.rawMaterialId}>
                <td className="py-2 pl-3 text-ink">{r.materialName}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{formatQuantityWithUnit(r.quantity, r.unit)}</td>
                <td className="py-2 px-3 text-right font-medium">{money(Number(r.total))}</td>
              </tr>
            ))}
          </ReportTable>
        </Card>
      )}
    </>
  );
}

// --------------------------- Inventory Report -----------------------------

interface InventoryItemRow {
  id: string;
  name: string;
  unit: string;
  quantityInStock: number;
  value: number;
  lowStock: boolean;
}

function InventoryReport() {
  const [data, setData] = useState<{
    rawMaterials: InventoryItemRow[];
    finishedGoods: InventoryItemRow[];
    totalRawValue: number;
    totalFinishedValue: number;
    totalValue: number;
  } | null>(null);

  useEffect(() => {
    api.get('/reports/inventory-detail').then((res) => setData(res.data));
  }, []);

  if (!data) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <>
      <div className="flex justify-end mb-2">
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Raw Materials Value</div>
          <div className="text-lg font-semibold text-ink">{money(data.totalRawValue)} OMR</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Finished Goods Value</div>
          <div className="text-lg font-semibold text-ink">{money(data.totalFinishedValue)} OMR</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Total Stock Value</div>
          <div className="text-lg font-semibold text-ink">{money(data.totalValue)} OMR</div>
        </Card>
      </div>

      <SectionTitle>Raw Materials</SectionTitle>
      <Card className="p-4 mb-4">
        <ReportTable
          columns={[{ label: 'Name' }, { label: 'Qty in Stock', align: 'right' }, { label: 'Value', align: 'right' }]}
          isEmpty={data.rawMaterials.length === 0}
          emptyMessage="No raw materials."
          footer={
            <tr className="border-t border-black/10 font-semibold text-blue-700">
              <td colSpan={2} className="py-2 pl-3">Total</td>
              <td className="py-2 px-3 text-right">{money(data.totalRawValue)}</td>
            </tr>
          }
        >
          {data.rawMaterials.map((m) => (
            <tr key={m.id}>
              <td className={`py-2 pl-3 font-medium ${m.lowStock ? 'text-amber-700' : 'text-ink'}`}>
                {m.name}
                {m.lowStock ? <span className="ml-1.5 text-xs font-normal">(Low stock)</span> : null}
              </td>
              <td className="py-2 px-3 text-right whitespace-nowrap">{formatQuantityWithUnit(m.quantityInStock, m.unit)}</td>
              <td className="py-2 px-3 text-right font-medium">{money(Number(m.value))}</td>
            </tr>
          ))}
        </ReportTable>
      </Card>

      <SectionTitle>Finished Goods</SectionTitle>
      <Card className="p-4">
        <ReportTable
          columns={[{ label: 'Name' }, { label: 'Qty in Stock', align: 'right' }, { label: 'Value', align: 'right' }]}
          isEmpty={data.finishedGoods.length === 0}
          emptyMessage="No finished goods."
          footer={
            <tr className="border-t border-black/10 font-semibold text-blue-700">
              <td colSpan={2} className="py-2 pl-3">Total</td>
              <td className="py-2 px-3 text-right">{money(data.totalFinishedValue)}</td>
            </tr>
          }
        >
          {data.finishedGoods.map((g) => (
            <tr key={g.id}>
              <td className={`py-2 pl-3 font-medium ${g.lowStock ? 'text-amber-700' : 'text-ink'}`}>
                {g.name}
                {g.lowStock ? <span className="ml-1.5 text-xs font-normal">(Low stock)</span> : null}
              </td>
              <td className="py-2 px-3 text-right whitespace-nowrap">{formatQuantityWithUnit(g.quantityInStock, g.unit)}</td>
              <td className="py-2 px-3 text-right font-medium">{money(Number(g.value))}</td>
            </tr>
          ))}
        </ReportTable>
      </Card>
    </>
  );
}

// ------------------------ Books Health Check ---------------------------

interface BooksCheckRow {
  key: string;
  title: string;
  ledgerLabel: string;
  ledger: number;
  recordsLabel: string;
  records: number;
  difference: number;
  ok: boolean;
  explain: string;
}

// A document saved without its journal entry (a posting failed).
interface MissingJournalRow {
  sourceType: string;
  label: string;
  id: string;
  number: string;
  date: string;
  amount: number;
  canRepost: boolean;
  locked?: boolean;
}

// Each control account in the ledger must equal the records behind it
// (customers, suppliers, stock, bank, VAT). A difference means an entry
// reached one side but not the other.
function BooksCheckReport() {
  const { hasAnyRole } = useAuth();
  // backend allows Re-post for Admin/Accountant only
  const canRepost = hasAnyRole(['admin', 'accountant']);
  const [data, setData] = useState<{ checkedAt: string; ok: boolean; checks: BooksCheckRow[]; missingJournals?: MissingJournalRow[] } | null>(null);
  const [error, setError] = useState('');
  const [reposting, setReposting] = useState('');
  const [repostError, setRepostError] = useState('');

  async function repost(row: MissingJournalRow) {
    setReposting(`${row.sourceType}:${row.id}`);
    setRepostError('');
    try {
      await api.post('/reports/books-check/repost', { sourceType: row.sourceType, sourceId: row.id });
      load();
    } catch (err: any) {
      setRepostError(`${row.label} ${row.number}: ${err?.response?.data?.message || 'Could not re-post.'}`);
    } finally {
      setReposting('');
    }
  }

  function load() {
    setData(null);
    setError('');
    api
      .get('/reports/books-check')
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message || 'Could not run the check.'));
  }
  useEffect(load, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="text-sm text-muted">Checking the books…</div>;
  const failed = data.checks.filter((c) => !c.ok).length;
  const missing = data.missingJournals || [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="text-sm text-muted">Checked {new Date(data.checkedAt).toLocaleString()}</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${data.ok ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
            {data.ok ? 'All checks passed' : `${failed} check(s) need attention`}
          </span>
          <button
            type="button"
            onClick={load}
            className="print:hidden text-sm font-medium text-ink/70 hover:text-ink border border-black/10 rounded-lg px-3 py-1.5"
          >
            Run again
          </button>
          <PrintButton />
        </div>
      </div>
      <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
        {data.checks.map((c) => (
          <div key={c.key} className={`px-3 py-3 ${c.ok ? '' : 'bg-red-50/60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-ink">{c.title}</div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.ok ? 'bg-brand-50 text-brand-700' : 'bg-red-100 text-red-700'}`}>
                {c.ok ? 'OK' : c.key === 'missing_journals' ? `${c.ledger} missing` : `Difference ${money(c.difference)}`}
              </span>
            </div>
            {c.key === 'missing_journals' ? (
              <div className="mt-1 text-xs text-muted">
                {c.ledgerLabel}: <span className="text-ink">{c.ledger}</span>
              </div>
            ) : (
              <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-2">
                <div>
                  {c.ledgerLabel}: <span className="text-ink">{money(c.ledger)}</span>
                </div>
                <div>
                  {c.recordsLabel}: <span className="text-ink">{money(c.records)}</span>
                </div>
              </div>
            )}
            <div className="mt-1 text-xs text-muted">{c.explain}</div>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-ink mb-2">Documents without a journal entry</div>
          {repostError && <p className="text-sm text-red-600 mb-2">{repostError}</p>}
          <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
            {missing.map((m) => {
              const key = `${m.sourceType}:${m.id}`;
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">
                      {m.label} {m.number}
                    </div>
                    <div className="text-xs text-muted">
                      {m.date} · {money(m.amount)} OMR
                    </div>
                  </div>
                  {m.locked ? (
                    <span className="shrink-0 text-xs text-muted">Closed period - cannot be re-posted. Contact support.</span>
                  ) : m.canRepost ? (
                    canRepost && (
                      <button
                        type="button"
                        disabled={reposting === key}
                        onClick={() => repost(m)}
                        className="print:hidden shrink-0 text-sm font-medium text-ink border border-black/10 rounded-lg px-3 py-1.5 hover:bg-black/5 disabled:opacity-50"
                      >
                        {reposting === key ? 'Re-posting…' : 'Re-post'}
                      </button>
                    )
                  ) : (
                    <span className="shrink-0 text-xs text-muted">Can't be re-posted automatically. Contact support.</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
