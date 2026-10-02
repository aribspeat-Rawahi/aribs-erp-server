import { useEffect, useMemo, useState } from 'react';
import { Clock, ArrowDownCircle, ArrowUpCircle, Hourglass } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, StatCard, Pill } from '../components/ui';

type PendingRowType =
  | 'invoice_due'
  | 'supplier_bill_due'
  | 'payroll_unpaid'
  | 'reimbursement_pending'
  | 'salary_advance_pending';

interface PendingPaymentRow {
  id: string;
  type: PendingRowType;
  direction: 'in' | 'out';
  awaitingApproval: boolean;
  date: string;
  partyName: string;
  reference?: string;
  amount: number;
  note?: string;
}

const TYPE_LABELS: Record<PendingRowType, string> = {
  invoice_due: 'Invoice Due',
  supplier_bill_due: 'Supplier Bill Due',
  payroll_unpaid: 'Salary Unpaid',
  reimbursement_pending: 'Reimbursement',
  salary_advance_pending: 'Salary Advance',
};

const TYPE_TONE: Record<PendingRowType, string> = {
  invoice_due: 'bg-brand-50 text-brand-700',
  supplier_bill_due: 'bg-amber-50 text-amber-700',
  payroll_unpaid: 'bg-blue-50 text-blue-700',
  reimbursement_pending: 'bg-purple-50 text-purple-700',
  salary_advance_pending: 'bg-red-50 text-red-600',
};

const FILTERS: { value: 'all' | PendingRowType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'invoice_due', label: 'Invoice Due' },
  { value: 'supplier_bill_due', label: 'Supplier Bill' },
  { value: 'payroll_unpaid', label: 'Salary' },
  { value: 'reimbursement_pending', label: 'Reimbursement' },
  { value: 'salary_advance_pending', label: 'Salary Advance' },
];

// Read-only, combined view of everything still owed or waiting: unpaid
// customer invoices, unpaid supplier bills, salary not yet paid out, and
// reimbursement / salary advance requests still in the approval or
// payout queue. The mirror-opposite of Payments.tsx (which shows what has
// already moved) — nothing here is editable, each item is still actioned
// on its own original page (Invoices, Suppliers, HR, Reimbursements,
// Approvals, Salary Advance).
export default function Pending() {
  const [rows, setRows] = useState<PendingPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | PendingRowType>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/payments/pending').then((res) => setRows(res.data)).finally(() => setLoading(false));
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
  const awaitingApprovalCount = rows.filter((r) => r.awaitingApproval).length;

  return (
    <div>
      <PageHeader
        title="Pending"
        subtitle="Everything still owed or waiting — unpaid invoices, unpaid bills, unpaid salary, and requests waiting on approval or payout"
      />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <StatCard icon={ArrowDownCircle} label="Owed to us" value={`${totalIn.toFixed(3)} OMR`} sub="unpaid invoices" />
        <StatCard icon={ArrowUpCircle} label="We owe / to pay out" value={`${totalOut.toFixed(3)} OMR`} sub="bills, salary, reimbursement, advance" />
        <StatCard icon={Hourglass} label="Awaiting approval" value={String(awaitingApprovalCount)} sub="reimbursement / salary advance requests" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <Pill options={FILTERS} value={filter} onChange={(v) => setFilter(v as 'all' | PendingRowType)} />
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
        <EmptyState>Nothing pending — all caught up.</EmptyState>
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
                    {r.awaitingApproval && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 inline-flex items-center gap-1">
                        <Clock size={11} /> Awaiting approval
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {formatDate(r.date)}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-semibold ${r.direction === 'in' ? 'text-brand-700' : 'text-red-600'}`}>
                    {r.direction === 'in' ? '+' : '-'}
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

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
