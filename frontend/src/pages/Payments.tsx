import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, StatCard, Pill } from '../components/ui';

type PaymentRowType = 'invoice_payment' | 'supplier_payment' | 'payroll' | 'reimbursement' | 'tax_payment' | 'fund_transfer';

interface CombinedPaymentRow {
  id: string;
  type: PaymentRowType;
  direction: 'in' | 'out' | 'internal';
  date: string;
  partyName: string;
  reference?: string;
  amount: number;
  method: string;
  note?: string;
}

const TYPE_LABELS: Record<PaymentRowType, string> = {
  invoice_payment: 'Invoice Payment',
  supplier_payment: 'Supplier Payment',
  payroll: 'Salary Payment',
  reimbursement: 'Reimbursement',
  tax_payment: 'Tax Payment',
  fund_transfer: 'Internal Transfer',
};

const TYPE_TONE: Record<PaymentRowType, string> = {
  invoice_payment: 'bg-brand-50 text-brand-700',
  supplier_payment: 'bg-amber-50 text-amber-700',
  payroll: 'bg-blue-50 text-blue-700',
  reimbursement: 'bg-purple-50 text-purple-700',
  tax_payment: 'bg-red-50 text-red-600',
  fund_transfer: 'bg-black/5 text-ink/70',
};

const FILTERS: { value: 'all' | PaymentRowType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'invoice_payment', label: 'Invoice' },
  { value: 'supplier_payment', label: 'Supplier' },
  { value: 'payroll', label: 'Salary' },
  { value: 'reimbursement', label: 'Reimbursement' },
  { value: 'tax_payment', label: 'Tax' },
  { value: 'fund_transfer', label: 'Transfer' },
];

// Read-only, combined view of every payment already recorded elsewhere in
// the system (Invoices, Suppliers, HR Payroll, Reimbursements, Tax, Cash &
// Bank). Nothing here is editable — each row is still managed on its own
// original page; this is purely a consolidated list for a quick overview.
export default function Payments() {
  const [rows, setRows] = useState<CombinedPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | PaymentRowType>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/payments').then((res) => setRows(res.data)).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== 'all' && r.type !== filter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          r.partyName.toLowerCase().includes(q) ||
          (r.reference || '').toLowerCase().includes(q) ||
          (r.note || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, filter, search]);

  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0);
  const totalInternal = rows.filter((r) => r.direction === 'internal').reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Every payment recorded across Invoices, Suppliers, Payroll, Reimbursements, Tax and Cash & Bank, in one place"
      />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <StatCard icon={ArrowDownCircle} label="Total received" value={`${totalIn.toFixed(3)} OMR`} sub="invoice payments" />
        <StatCard icon={ArrowUpCircle} label="Total paid out" value={`${totalOut.toFixed(3)} OMR`} sub="supplier, salary, reimbursement, tax" />
        <StatCard icon={ArrowLeftRight} label="Internal transfers" value={`${totalInternal.toFixed(3)} OMR`} sub="between own accounts" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <Pill options={FILTERS} value={filter} onChange={(v) => setFilter(v as 'all' | PaymentRowType)} />
        <input
          className="px-3 py-1.5 rounded-lg border border-black/10 text-sm w-64"
          placeholder="Search party, reference, note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState>No payments match this filter.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {filtered.map((r) => (
              <div key={`${r.type}-${r.id}`} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_TONE[r.type]}`}>
                      {TYPE_LABELS[r.type]}
                    </span>
                    <span className="text-sm font-medium text-ink truncate">{r.partyName}</span>
                    {r.reference && <span className="text-xs text-muted">{r.reference}</span>}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {formatDate(r.date)} · {r.method}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DirectionIcon direction={r.direction} />
                  <span
                    className={`text-sm font-semibold ${
                      r.direction === 'in' ? 'text-brand-700' : r.direction === 'out' ? 'text-red-600' : 'text-ink/70'
                    }`}
                  >
                    {r.direction === 'out' ? '-' : r.direction === 'in' ? '+' : ''}
                    {r.amount.toFixed(3)} OMR
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function DirectionIcon({ direction }: { direction: 'in' | 'out' | 'internal' }) {
  if (direction === 'in') return <ArrowDownCircle size={16} className="text-brand-600" />;
  if (direction === 'out') return <ArrowUpCircle size={16} className="text-red-500" />;
  return <ArrowLeftRight size={16} className="text-ink/40" />;
}

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
