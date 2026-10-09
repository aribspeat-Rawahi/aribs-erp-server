import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Wallet, TrendingUp, TrendingDown, Receipt, Upload, Eye, Pencil, Trash2, Check, X, BadgeDollarSign } from 'lucide-react';
import BankAccountSelect from '../components/BankAccountSelect';
import api from '../api/client';
import { viewFile } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass, StatCard } from '../components/ui';
import ReportsPanel from './ReportsPanel';
import JournalsPanel from './JournalsPanel';
import AccountsPanel from './AccountsPanel';
import TaxPanel from './TaxPanel';
import FixedAssetsPanel from './FixedAssetsPanel';
import AnalyticsPanel from './AnalyticsPanel';
import OpeningBalancesPanel from './OpeningBalancesPanel';
import { localISODate } from '../utils/dates';

const EXPENSE_CATEGORY_OPTIONS = [
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'salary', label: 'Salary' },
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'transport', label: 'Transport' },
  { value: 'other', label: 'Other' },
];
// 'raw_material' stays only to label old records: raw material is bought
// with a purchase order (it is stock, not an expense).

const REIMBURSEMENT_CATEGORY_OPTIONS = [
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'medical', label: 'Medical' },
  { value: 'other', label: 'Other' },
];

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label || value;
}

const reimbursementStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  paid: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  description?: string;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceFilePath?: string;
  bankAccountId?: string;
}

interface Employee {
  id: string;
  name: string;
}

interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}

interface Reimbursement {
  id: string;
  claimNumber: string;
  employeeId: string;
  category: string;
  amount: number | string;
  date: string;
  description?: string;
  invoiceNumber?: string;
  receiptFilePath?: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  rejectionReason?: string;
  paymentMethod?: string;
  paymentNote?: string;
  bankAccountId?: string;
  paidAt?: string;
}

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => localISODate(d);
  return { startDate: iso(start), endDate: iso(end) };
}

type Tab = 'expenses' | 'reimbursements' | 'reports' | 'analytics' | 'journals' | 'accounts' | 'tax' | 'fixedAssets' | 'opening';

const VALID_TABS: Tab[] = ['expenses', 'reimbursements', 'reports', 'analytics', 'journals', 'accounts', 'tax', 'fixedAssets', 'opening'];

export default function Accounting() {
  const { hasAnyRole } = useAuth();
  const canDecide = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'expenses';
  const [tab, setTab] = useState<Tab>(VALID_TABS.includes(initialTab) ? initialTab : 'expenses');
  // a link to another tab (e.g. the opening-balances banner) while already
  // on this page changes only the query string - follow it
  const urlTab = searchParams.get('tab') as Tab | null;
  useEffect(() => {
    if (urlTab && VALID_TABS.includes(urlTab)) setTab(urlTab);
  }, [urlTab]);

  // Expenses
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);

  // Reimbursements
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [reimbLoading, setReimbLoading] = useState(true);
  const [showAddReimb, setShowAddReimb] = useState(false);
  const [editReimb, setEditReimb] = useState<Reimbursement | null>(null);
  const [rejectingReimb, setRejectingReimb] = useState<Reimbursement | null>(null);
  const [payingReimb, setPayingReimb] = useState<Reimbursement | null>(null);
  const [uploadingReceiptId, setUploadingReceiptId] = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptTargetId = useRef<string | null>(null);

  async function onInvoiceFileSelected(id: string, file: File) {
    setUploadingId(id);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/expenses/${id}/invoice`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not upload the invoice.');
    } finally {
      setUploadingId(null);
    }
  }

  function load() {
    setLoading(true);
    const { startDate, endDate } = monthRange();
    Promise.all([api.get('/expenses'), api.get('/accounting/summary', { params: { startDate, endDate } })])
      .then(([e, s]) => {
        setExpenses(e.data.sort((a: Expense, b: Expense) => (a.date < b.date ? 1 : -1)));
        setSummary(s.data);
      })
      .finally(() => setLoading(false));
  }

  function loadReimbursements() {
    setReimbLoading(true);
    api
      .get('/reimbursements')
      .then((res) => setReimbursements(res.data))
      .finally(() => setReimbLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get('/employees').then((res) => setEmployees(res.data));
    api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
  }, []);
  useEffect(() => {
    if (tab === 'reimbursements') loadReimbursements();
  }, [tab]);

  function employeeName(id: string) {
    return employees.find((e) => e.id === id)?.name || id;
  }

  function bankAccountName(id?: string) {
    if (!id) return undefined;
    return bankAccounts.find((b) => b.id === id)?.name;
  }

  async function onReceiptFileSelected(id: string, file: File) {
    setUploadingReceiptId(id);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/reimbursements/${id}/receipt`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      loadReimbursements();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Could not upload the receipt.');
    } finally {
      setUploadingReceiptId(null);
    }
  }

  async function removeReimbursement(id: string) {
    if (!window.confirm('Delete this reimbursement claim? This cannot be undone.')) return;
    try {
      await api.delete(`/reimbursements/${id}`);
      loadReimbursements();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this claim.');
    }
  }

  async function approveReimbursement(id: string) {
    try {
      await api.post(`/reimbursements/${id}/approve`);
      loadReimbursements();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not approve this claim.');
    }
  }

  // Cards come from the ledger (same as the Income Statement), so
  // Revenue - Total costs = Net Profit on screen.
  const revenue = summary?.ledger?.revenue ?? 0;
  const totalExpenses = summary?.ledger?.expenses ?? 0;
  const netProfit = summary?.netProfit ?? 0;

  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle="Expenses, reimbursements, reports, and journals"
      />

      <div className="mb-4">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'expenses', label: 'Expenses' },
            { value: 'reimbursements', label: 'Reimbursements' },
            { value: 'reports', label: 'Reports' },
            { value: 'analytics', label: 'Analytics' },
            { value: 'journals', label: 'Journals' },
            { value: 'accounts', label: 'Accounts' },
            { value: 'tax', label: 'Tax' },
            { value: 'fixedAssets', label: 'Fixed Assets' },
            { value: 'opening', label: 'Opening Balances' },
          ]}
        />
      </div>

      {tab === 'expenses' && (
        <>
          <div className="flex justify-end mb-4">
            <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>Add expense</PrimaryButton>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatCard icon={TrendingUp} label="Revenue (this month)" value={`${Number(revenue).toFixed(3)} OMR`} sub="excl. VAT" />
            <StatCard
              icon={TrendingDown}
              label="Total costs (this month)"
              value={`${Number(totalExpenses).toFixed(3)} OMR`}
              sub="Incl. cost of goods sold, salaries, depreciation"
            />
            <StatCard icon={Wallet} label="Net Profit" value={`${Number(netProfit).toFixed(3)} OMR`} />
          </div>

          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
            <Receipt size={15} />
            Recent Expenses
          </div>
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : expenses.length === 0 ? (
            <EmptyState>No expenses recorded yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {expenses.map((exp) => (
                  <div key={exp.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        {labelFor(EXPENSE_CATEGORY_OPTIONS, exp.category)}
                        {exp.vendorName ? ` · ${exp.vendorName}` : ''}
                      </div>
                      <div className="text-xs text-muted">
                        {exp.date}
                        {exp.invoiceNumber ? ` · Invoice #${exp.invoiceNumber}` : ''}
                        {exp.description ? ` · ${exp.description}` : ''}
                        {bankAccountName(exp.bankAccountId) ? ` · Paid from ${bankAccountName(exp.bankAccountId)}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(exp.amount).toFixed(3)} OMR</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {exp.invoiceFilePath ? (
                          <IconButton icon={Eye} title="View invoice" onClick={() => viewFile(`/expenses/${exp.id}/invoice`)} />
                        ) : (
                          <SecondaryButton
                            icon={Upload}
                            requires="edit"
                            onClick={() => {
                              uploadTargetId.current = exp.id;
                              uploadInputRef.current?.click();
                            }}
                          >
                            {uploadingId === exp.id ? 'Uploading…' : 'Scan/Upload invoice'}
                          </SecondaryButton>
                        )}
                        <IconButton icon={Pencil} requires="edit" title="Edit expense" onClick={() => setEditExpense(exp)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <input
            ref={uploadInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const id = uploadTargetId.current;
              e.target.value = '';
              if (file && id) onInvoiceFileSelected(id, file);
            }}
          />

          {editExpense && (
            <EditExpenseModal
              expense={editExpense}
              bankAccounts={bankAccounts}
              onClose={() => setEditExpense(null)}
              onSaved={() => {
                setEditExpense(null);
                load();
              }}
            />
          )}

          {showAdd && (
            <AddExpenseModal
              bankAccounts={bankAccounts}
              onClose={() => setShowAdd(false)}
              onSaved={() => {
                setShowAdd(false);
                load();
              }}
            />
          )}
        </>
      )}

      {tab === 'reimbursements' && (
        <>
          <div className="flex justify-end mb-4">
            <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddReimb(true)}>New claim</PrimaryButton>
          </div>

          {reimbLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : reimbursements.length === 0 ? (
            <EmptyState>No reimbursement claims yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {reimbursements.map((r) => (
                  <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        {employeeName(r.employeeId)} · {labelFor(REIMBURSEMENT_CATEGORY_OPTIONS, r.category)}
                      </div>
                      <div className="text-xs text-muted">
                        {r.claimNumber} · {r.date}
                        {r.invoiceNumber ? ` · Invoice #${r.invoiceNumber}` : ''}
                        {r.description ? ` · ${r.description}` : ''}
                        {r.status === 'rejected' && r.rejectionReason ? ` · Rejected: ${r.rejectionReason}` : ''}
                        {r.status === 'paid' && r.paymentMethod ? ` · Paid via ${r.paymentMethod}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(r.amount).toFixed(3)} OMR</div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${reimbursementStatusTone[r.status] || 'bg-black/5 text-ink/70'}`}>
                        {r.status}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.receiptFilePath ? (
                          <IconButton icon={Eye} title="View receipt" onClick={() => viewFile(`/reimbursements/${r.id}/receipt`)} />
                        ) : (
                          <SecondaryButton
                            icon={Upload}
                            requires="edit"
                            onClick={() => {
                              receiptTargetId.current = r.id;
                              receiptInputRef.current?.click();
                            }}
                          >
                            {uploadingReceiptId === r.id ? 'Uploading…' : 'Scan/Upload receipt'}
                          </SecondaryButton>
                        )}
                        {r.status === 'pending' && (
                          <>
                            <IconButton icon={Pencil} requires="edit" title="Edit claim" onClick={() => setEditReimb(r)} />
                            <IconButton icon={Trash2} tone="danger" requires="full" title="Delete claim" onClick={() => removeReimbursement(r.id)} />
                            {canDecide && (
                              <>
                                <IconButton icon={Check} tone="success" requires="edit" requiresModule="approvals" title="Approve" onClick={() => approveReimbursement(r.id)} />
                                <IconButton icon={X} tone="danger" requires="edit" requiresModule="approvals" title="Reject" onClick={() => setRejectingReimb(r)} />
                              </>
                            )}
                          </>
                        )}
                        {r.status === 'approved' && canDecide && (
                          <IconButton icon={BadgeDollarSign} requires="edit" requiresModule="approvals" title="Mark as paid" onClick={() => setPayingReimb(r)} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <input
            ref={receiptInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const id = receiptTargetId.current;
              e.target.value = '';
              if (file && id) onReceiptFileSelected(id, file);
            }}
          />

          {showAddReimb && (
            <ReimbursementModal
              employees={employees}
              onClose={() => setShowAddReimb(false)}
              onSaved={() => {
                setShowAddReimb(false);
                loadReimbursements();
              }}
            />
          )}
          {editReimb && (
            <ReimbursementModal
              claim={editReimb}
              employees={employees}
              onClose={() => setEditReimb(null)}
              onSaved={() => {
                setEditReimb(null);
                loadReimbursements();
              }}
            />
          )}
          {rejectingReimb && (
            <RejectReimbursementModal
              claim={rejectingReimb}
              onClose={() => setRejectingReimb(null)}
              onSaved={() => {
                setRejectingReimb(null);
                loadReimbursements();
              }}
            />
          )}
          {payingReimb && (
            <MarkPaidModal
              claim={payingReimb}
              bankAccounts={bankAccounts}
              onClose={() => setPayingReimb(null)}
              onSaved={() => {
                setPayingReimb(null);
                loadReimbursements();
              }}
            />
          )}
        </>
      )}

      {tab === 'reports' && <ReportsPanel />}

      {tab === 'analytics' && <AnalyticsPanel />}

      {tab === 'journals' && <JournalsPanel />}

      {tab === 'accounts' && <AccountsPanel />}

      {tab === 'tax' && <TaxPanel />}

      {tab === 'fixedAssets' && <FixedAssetsPanel />}

      {tab === 'opening' && <OpeningBalancesPanel />}
    </div>
  );
}

function AddExpenseModal({
  bankAccounts,
  onClose,
  onSaved,
}: {
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(EXPENSE_CATEGORY_OPTIONS[0].value);
  const [amount, setAmount] = useState('0');
  const [date, setDate] = useState(localISODate());
  const [description, setDescription] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/expenses', {
        category,
        amount: Number(amount),
        date,
        description: description || undefined,
        vendorName: vendorName || undefined,
        invoiceNumber: invoiceNumber || undefined,
        bankAccountId: bankAccountId || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add expense" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORY_OPTIONS.filter((c) => c.value !== 'raw_material').map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor name (optional)">
            <input className={inputClass} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </Field>
          <Field label="Invoice number (optional)">
            <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function EditExpenseModal({
  expense,
  bankAccounts,
  onClose,
  onSaved,
}: {
  expense: Expense;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [date, setDate] = useState(expense.date);
  const [description, setDescription] = useState(expense.description || '');
  const [vendorName, setVendorName] = useState(expense.vendorName || '');
  const [invoiceNumber, setInvoiceNumber] = useState(expense.invoiceNumber || '');
  const [bankAccountId, setBankAccountId] = useState(expense.bankAccountId || '');
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/expenses/${expense.id}`, {
        category,
        amount: Number(amount),
        date,
        // Send the raw values (not `|| undefined`) here: unlike Add, an
        // edit can legitimately clear a field back to empty — `undefined`
        // would get dropped from the JSON body and silently keep the old
        // value on the backend instead of clearing it.
        description,
        vendorName,
        invoiceNumber,
        bankAccountId,
      });
      if (replaceFile) {
        const formData = new FormData();
        formData.append('file', replaceFile);
        await api.post(`/expenses/${expense.id}/invoice`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit expense" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORY_OPTIONS.filter((c) => c.value !== 'raw_material' || expense.category === 'raw_material').map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor name (optional)">
            <input className={inputClass} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </Field>
          <Field label="Invoice number (optional)">
            <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        <Field label={expense.invoiceFilePath ? 'Replace invoice file (optional)' : 'Invoice file (optional)'}>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={inputClass}
            onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ReimbursementModal({
  claim,
  employees,
  onClose,
  onSaved,
}: {
  claim?: Reimbursement;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(claim?.employeeId || employees[0]?.id || '');
  const [category, setCategory] = useState(claim?.category || REIMBURSEMENT_CATEGORY_OPTIONS[0].value);
  const [amount, setAmount] = useState(claim ? String(claim.amount) : '0');
  const [date, setDate] = useState(claim?.date || localISODate());
  const [description, setDescription] = useState(claim?.description || '');
  const [invoiceNumber, setInvoiceNumber] = useState(claim?.invoiceNumber || '');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      employeeId,
      category,
      amount: Number(amount),
      date,
      description: description || undefined,
      invoiceNumber: invoiceNumber || undefined,
    };
    try {
      let id = claim?.id;
      if (claim) await api.patch(`/reimbursements/${claim.id}`, payload);
      else {
        const res = await api.post('/reimbursements', payload);
        id = res.data.id;
      }
      // Uploaded right after the claim exists (backend requires the
      // record's id first) — same two-step flow Expense's own upload uses.
      if (receiptFile && id) {
        const formData = new FormData();
        formData.append('file', receiptFile);
        await api.post(`/reimbursements/${id}/receipt`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || `Could not ${claim ? 'update' : 'submit'} the claim.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={claim ? 'Edit reimbursement claim' : 'New reimbursement claim'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Employee">
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {REIMBURSEMENT_CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label="Date incurred">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Claim against invoice no (optional)">
          <input
            className={inputClass}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="Vendor/supplier invoice or bill number"
          />
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={claim?.receiptFilePath ? 'Replace receipt/document (optional)' : 'Receipt/document (optional)'}>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={inputClass}
            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : claim ? 'Save' : 'Submit'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RejectReimbursementModal({
  claim,
  onClose,
  onSaved,
}: {
  claim: Reimbursement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/reimbursements/${claim.id}/reject`, { reason });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not reject this claim.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Reject claim" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Reason">
          <input className={inputClass} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" requiresModule="approvals" disabled={busy}>{busy ? 'Saving…' : 'Reject'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function MarkPaidModal({
  claim,
  bankAccounts,
  onClose,
  onSaved,
}: {
  claim: Reimbursement;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/reimbursements/${claim.id}/mark-paid`, {
        paymentMethod,
        note: note || undefined,
        bankAccountId: bankAccountId || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not mark this claim as paid.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Mark as paid" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          {Number(claim.amount).toFixed(3)} OMR to be paid
        </div>
        <Field label="Payment method">
          <input className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Cash, Bank Transfer, Cheque…" required />
        </Field>
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" requiresModule="approvals" disabled={busy}>{busy ? 'Saving…' : 'Confirm payment'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
