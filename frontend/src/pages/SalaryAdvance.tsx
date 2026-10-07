import { FormEvent, useEffect, useState } from 'react';
import { Plus, Banknote } from 'lucide-react';
import BankAccountSelect from '../components/BankAccountSelect';
import api from '../api/client';
import { PageHeader, PrimaryButton, SecondaryButton, Card, StatCard, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { useAuth } from '../context/AuthContext';

interface EmployeeOption {
  id: string;
  name: string;
  baseSalary?: number;
  active: boolean;
}

interface SalaryAdvanceRow {
  id: string;
  employeeId: string | null;
  employeeName: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedByEmail?: string;
  decidedByEmail?: string;
  decidedAt?: string;
  disbursed: boolean;
  disbursedDate?: string;
  createdAt: string;
}

interface BankAccountOption {
  id: string;
  name: string;
  currentBalance: number | string;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

// Salary Advance — request + record keeping. The actual accept/reject
// decision happens on the Approvals page (this request rides the same
// generic Approval Workflow as invoice/quotation gates); this page is
// for submitting a request, seeing every request's status/history, and
// — once approved — recording the actual payout ("Disburse").
export default function SalaryAdvance() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [rows, setRows] = useState<SalaryAdvanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequest, setShowRequest] = useState(false);
  const [disbursingItem, setDisbursingItem] = useState<SalaryAdvanceRow | null>(null);

  function load() {
    setLoading(true);
    api.get('/salary-advances').then((res) => setRows(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get('/employees').then((res) => setEmployees((res.data as EmployeeOption[]).filter((e) => e.active)));
    if (canManage) api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
  }, [canManage]);

  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const approvedNotDisbursed = rows.filter((r) => r.status === 'approved' && !r.disbursed);
  const totalDisbursed = rows.filter((r) => r.disbursed).reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div>
      <PageHeader
        title="Salary Advance"
        subtitle="Request an advance and track every request through approval and payout"
        action={
          <PrimaryButton icon={Plus} onClick={() => setShowRequest(true)} requires="edit">
            New request
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 mb-5">
        <StatCard icon={Banknote} label="Pending approval" value={String(pendingCount)} sub="waiting on Approvals" />
        <StatCard icon={Banknote} label="Approved, not disbursed" value={String(approvedNotDisbursed.length)} sub="ready to pay out" />
        <StatCard icon={Banknote} label="Total disbursed" value={`${totalDisbursed.toFixed(3)} OMR`} sub="all time" />
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState>No salary advance requests yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">{r.employeeName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_TONE[r.status]}`}>
                      {r.status}
                    </span>
                    {r.disbursed && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">
                        Disbursed {r.disbursedDate ? formatDate(r.disbursedDate) : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink/80 mt-0.5">{r.reason}</p>
                  <p className="text-xs text-muted mt-1">
                    {r.requestedByEmail ? `Requested by ${r.requestedByEmail} · ` : ''}
                    {new Date(r.createdAt).toLocaleString()}
                    {r.decidedByEmail ? ` · Decided by ${r.decidedByEmail}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-start shrink-0">
                  <span className="text-sm font-semibold text-brand-700">{Number(r.amount).toFixed(3)} OMR</span>
                  {canManage && r.status === 'approved' && !r.disbursed && (
                    <SecondaryButton onClick={() => setDisbursingItem(r)} requires="edit" requiresModule="approvals">
                      Disburse
                    </SecondaryButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showRequest && (
        <NewRequestModal
          employees={employees}
          onClose={() => setShowRequest(false)}
          onSaved={() => {
            setShowRequest(false);
            load();
          }}
        />
      )}
      {disbursingItem && (
        <DisburseModal
          row={disbursingItem}
          bankAccounts={bankAccounts}
          onClose={() => setDisbursingItem(null)}
          onSaved={() => {
            setDisbursingItem(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function NewRequestModal({
  employees,
  onClose,
  onSaved,
}: {
  employees: EmployeeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!employeeId || !amount || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/salary-advances', { employeeId, amount: Number(amount), reason: reason.trim() });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not submit this request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request salary advance" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Employee">
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </Field>
        {selectedEmployee?.baseSalary != null && (
          <p className="text-xs text-muted -mt-2">Reference — base salary: {Number(selectedEmployee.baseSalary).toFixed(3)} OMR/month</p>
        )}
        <Field label="Amount (OMR)">
          <input
            className={inputClass}
            type="number"
            min="0.001"
            step="0.001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Reason">
          <textarea
            className={inputClass}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this advance is needed"
            required
          />
        </Field>
        <p className="text-xs text-muted">
          This goes to the Approvals page and stays pending until an Admin/CEO/MD/Accountant approves or rejects it.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Submitting…' : 'Submit request'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function DisburseModal({
  row,
  bankAccounts,
  onClose,
  onSaved,
}: {
  row: SalaryAdvanceRow;
  bankAccounts: BankAccountOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/salary-advances/${row.id}/disburse`, { bankAccountId: bankAccountId || undefined });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not record this disbursement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Disburse advance — ${row.employeeName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">{Number(row.amount).toFixed(3)} OMR to be paid out</div>
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit" requiresModule="approvals">
            {busy ? 'Saving…' : 'Confirm payout'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
