import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, IconButton } from '../components/ui';

interface ApprovalRow {
  id: string;
  kind: 'approval_request' | 'quotation_edit';
  type: string;
  entityType: 'invoice' | 'quotation' | 'salary_advance';
  targetId?: string;
  customerName?: string;
  reference?: string;
  reason: string;
  requestedByEmail?: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  credit_limit_override: 'Credit Limit',
  large_discount: 'Large Discount',
  vat_exclude: 'VAT Excluded',
  quotation_price_edit: 'Price Edit',
  salary_advance: 'Salary Advance',
};

const TYPE_TONE: Record<string, string> = {
  credit_limit_override: 'bg-red-50 text-red-600',
  large_discount: 'bg-amber-50 text-amber-700',
  vat_exclude: 'bg-blue-50 text-blue-700',
  quotation_price_edit: 'bg-purple-50 text-purple-700',
  salary_advance: 'bg-brand-50 text-brand-700',
};

// CRM Step 7 — combines the new generic ApprovalRequest rows (credit
// limit / large discount / VAT exclude, on invoice or quotation create/
// edit) with the pre-existing quotation different-day price-edit flow
// into one list. Approve/Reject route to whichever endpoint actually
// owns that row (see the two entity-specific backend controllers).
export default function Approvals() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/approvals/pending').then((res) => setRows(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  function endpointFor(row: ApprovalRow, action: 'approve' | 'reject') {
    if (row.kind === 'quotation_edit') {
      return `/quotations/edit-requests/${row.id}/${action}`;
    }
    if (row.entityType === 'salary_advance') {
      return `/salary-advances/approval-requests/${row.id}/${action}`;
    }
    const base = row.entityType === 'invoice' ? '/invoices' : '/quotations';
    return `${base}/approval-requests/${row.id}/${action}`;
  }

  async function act(row: ApprovalRow, action: 'approve' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this request?')) return;
    setBusyId(row.id);
    try {
      await api.post(endpointFor(row, action));
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not ${action} this request.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Credit limit, large discount, VAT-exclude, salary advance and quotation price-edit requests waiting on you"
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState>Nothing pending approval.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {rows.map((row) => (
              <div key={`${row.kind}-${row.id}`} className="flex items-start justify-between px-4 py-3 gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_TONE[row.type] || 'bg-black/5 text-ink/70'}`}>
                      {TYPE_LABELS[row.type] || row.type}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-black/5 text-ink/70 capitalize">
                      {row.entityType === 'salary_advance' ? 'HR' : row.entityType}
                    </span>
                    {row.entityType !== 'salary_advance' && (
                      <span className="text-sm font-medium text-ink">{row.customerName || 'Unknown customer'}</span>
                    )}
                    {row.reference && <span className="text-xs text-muted">{row.reference}</span>}
                  </div>
                  <p className="text-sm text-ink/80 mt-1">{row.reason}</p>
                  <p className="text-xs text-muted mt-1">
                    {row.requestedByEmail ? `Requested by ${row.requestedByEmail} · ` : ''}
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <IconButton
                    icon={CheckCircle2}
                    tone="success"
                    title="Approve"
                    requires="edit"
                    onClick={() => busyId !== row.id && act(row, 'approve')}
                  />
                  <IconButton
                    icon={XCircle}
                    tone="danger"
                    title="Reject"
                    requires="edit"
                    onClick={() => busyId !== row.id && act(row, 'reject')}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
