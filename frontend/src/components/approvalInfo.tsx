// Shared bits for documents that go through Settings > Approval rules
// (purchase orders, purchase requisitions).

export interface ApprovalStepView {
  id: string;
  documentType: 'purchase_order' | 'purchase_requisition';
  documentId: string;
  documentNumber: string;
  amount: number;
  round: number;
  step: number;
  totalSteps: number;
  roles: string[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  summary?: string | null;
  requestedByEmail?: string | null;
  decidedByEmail?: string | null;
  decidedAt?: string | null;
  comment?: string | null;
  createdAt: string;
}

export interface ApprovalBand {
  upToAmount: number | null;
  steps: string[][];
}

const ROLE_NAMES: Record<string, string> = {
  admin: 'Admin',
  ceo: 'CEO',
  md: 'MD',
  accountant: 'Accountant',
  production: 'Production',
  sales: 'Sales',
};

export function roleNames(roles: string[]) {
  const names = roles.map((r) => ROLE_NAMES[r] || r);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] || '';
}

// "Accountant or MD", "MD, then CEO"
export function describeSteps(steps: string[][]) {
  return steps.map((s) => roleNames(s)).join(', then ');
}

// the band an amount falls in (same rule as the backend)
export function bandFor(bands: ApprovalBand[] | undefined, amount: number): ApprovalBand | null {
  if (!bands || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => (a.upToAmount === null ? 1 : b.upToAmount === null ? -1 : a.upToAmount - b.upToAmount));
  return sorted.find((b) => b.upToAmount === null || amount <= b.upToAmount + 0.0005) || sorted[sorted.length - 1];
}

// one line for a list row
export function approvalLine(pending?: ApprovalStepView | null, last?: ApprovalStepView | null, status?: string) {
  if (pending) {
    return {
      tone: 'text-amber-700',
      text: `Waiting for ${roleNames(pending.roles)}${pending.totalSteps > 1 ? ` (step ${pending.step} of ${pending.totalSteps})` : ''}`,
    };
  }
  if (status === 'rejected' && last?.status === 'rejected') {
    return { tone: 'text-red-600', text: `Rejected by ${last.decidedByEmail || 'an approver'}${last.comment ? `: ${last.comment}` : ''}` };
  }
  if (last?.status === 'approved') {
    return { tone: 'text-brand-700', text: `Approved by ${last.decidedByEmail || 'an approver'}` };
  }
  return null;
}

export function ApprovalHistory({ rows }: { rows?: ApprovalStepView[] }) {
  if (!rows?.length) return null;
  return (
    <div>
      <span className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">Approval history</span>
      <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="text-ink">
                {r.round > 1 ? `Round ${r.round} · ` : ''}Step {r.step} of {r.totalSteps} · {roleNames(r.roles)}
              </div>
              <div className="text-xs text-muted">
                {r.status === 'pending'
                  ? 'Waiting'
                  : `${r.status === 'approved' ? 'Approved' : 'Rejected'} by ${r.decidedByEmail || '-'}${r.decidedAt ? ` · ${new Date(r.decidedAt).toLocaleString()}` : ''}`}
                {r.comment ? ` · "${r.comment}"` : ''}
              </div>
            </div>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                r.status === 'approved' ? 'bg-brand-50 text-brand-700' : r.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
