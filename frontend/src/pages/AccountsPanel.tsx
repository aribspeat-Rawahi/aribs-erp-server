import { FormEvent, useEffect, useState } from 'react';
import { Plus, Landmark, Wallet, ArrowLeftRight, Pencil, Trash2, Eye, Upload, Clock, CheckCircle2 } from 'lucide-react';
import api from '../api/client';
import { viewFile } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass, StatCard } from '../components/ui';
import { localISODate } from '../utils/dates';

interface BankAccount {
  id: string;
  name: string;
  type: 'bank' | 'cash';
  bankName?: string;
  accountNumber?: string;
  openingBalance: number | string;
  currentBalance: number | string;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number | string;
  date: string;
  note?: string;
  category?: string;
}

// Matches BankTransactionCategory / BANK_TRANSACTION_CATEGORY_LABEL in
// the backend (bank-transaction-category.enum.ts). Picking one is what
// makes a transaction auto-post to the Journal (Dr/Cr against the
// matching Chart-of-Accounts code) — leaving it unset keeps the old
// record-only behavior.
const DEPOSIT_CATEGORY_OPTIONS = [
  { value: 'owners_contribution', label: "Owner's Contribution" },
  { value: 'other_income', label: 'Other Income' },
  { value: 'opening_balance', label: 'Opening Balance' },
];
const WITHDRAWAL_CATEGORY_OPTIONS = [
  { value: 'owners_draw', label: "Owner's Draw" },
  { value: 'bank_charges', label: 'Bank Charges' },
  { value: 'other_expense', label: 'Other Expense' },
  { value: 'spf_payment', label: 'Social Protection Fund payment' },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  [...DEPOSIT_CATEGORY_OPTIONS, ...WITHDRAWAL_CATEGORY_OPTIONS].map((o) => [o.value, o.label]),
);

interface FundTransfer {
  id: string;
  transferNumber: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number | string;
  date: string;
  note?: string;
  status: 'completed' | 'in_transit';
  clearedDate?: string;
  documentFilePath?: string;
}

// "Accounts" tab inside Accounting — replaces the old standalone Cash &
// Bank page (moved in here, next to Journals/Reports, so all financial
// management lives under one menu item). Adds two things the old page
// didn't have: a Cash-vs-Bank balance split, and a Fund Transfer tool for
// moving money between the company's own accounts (with a supporting
// document and full edit/view/delete on each transfer).
export default function AccountsPanel() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [viewingTxns, setViewingTxns] = useState<BankAccount | null>(null);
  const [reconciling, setReconciling] = useState<BankAccount | null>(null);

  const [transfers, setTransfers] = useState<FundTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [editTransfer, setEditTransfer] = useState<FundTransfer | null>(null);
  const [viewTransfer, setViewTransfer] = useState<FundTransfer | null>(null);

  function loadAccounts() {
    setLoading(true);
    api.get('/bank-accounts').then((res) => setAccounts(res.data)).finally(() => setLoading(false));
  }

  function loadTransfers() {
    setTransfersLoading(true);
    api.get('/fund-transfers').then((res) => setTransfers(res.data)).finally(() => setTransfersLoading(false));
  }

  useEffect(loadAccounts, []);
  useEffect(loadTransfers, []);

  // opening date set but not finalized: an account's opening balance is
  // shown on its card but is not in the books (Trial Balance) yet
  const [openingPending, setOpeningPending] = useState<string | null>(null);
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  const [booksStarted, setBooksStarted] = useState(false);
  useEffect(() => {
    api
      .get('/settings')
      .then((res) => {
        const s = res.data || {};
        const d = s.openingBalanceDate ? String(s.openingBalanceDate).slice(0, 10) : null;
        setOpeningDate(d);
        setOpeningPending(d && !s.openingBalanceFinalizedAt ? d : null);
        setBooksStarted(!!s.openingBalanceFinalizedAt);
      })
      .catch(() => {});
  }, []);

  async function removeAccount(id: string) {
    if (!window.confirm('Delete this account? Its transaction history will also be removed.')) return;
    await api.delete(`/bank-accounts/${id}`);
    loadAccounts();
  }

  async function removeTransfer(id: string) {
    if (!window.confirm('Delete this fund transfer? This reverses its effect on both accounts.')) return;
    try {
      await api.delete(`/fund-transfers/${id}`);
      loadAccounts();
      loadTransfers();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this transfer.');
    }
  }

  async function clearTransfer(id: string) {
    if (!window.confirm('Mark this transfer as received? This credits the destination account now.')) return;
    try {
      await api.patch(`/fund-transfers/${id}/clear`);
      loadAccounts();
      loadTransfers();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not clear this transfer.');
    }
  }

  function accountName(id: string) {
    return accounts.find((a) => a.id === id)?.name || id;
  }

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const cashBalance = accounts.filter((a) => a.type === 'cash').reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const bankBalance = accounts.filter((a) => a.type === 'bank').reduce((sum, a) => sum + Number(a.currentBalance), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="text-sm font-semibold text-ink">Cash, Bank and Transfer Fund</div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton icon={ArrowLeftRight} requires="edit" onClick={() => setShowAddTransfer(true)}>
              Transfer fund
            </SecondaryButton>
            <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>
              New account
            </PrimaryButton>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard icon={Wallet} label="Total Balance" value={`${totalBalance.toFixed(3)} OMR`} />
        <StatCard icon={Wallet} label="Cash Balance" value={`${cashBalance.toFixed(3)} OMR`} />
        <StatCard icon={Landmark} label="Bank Balance" value={`${bankBalance.toFixed(3)} OMR`} />
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : accounts.length === 0 ? (
        <EmptyState>No bank or cash accounts yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {accounts.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 shrink-0 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
                    {a.type === 'cash' ? <Wallet size={16} /> : <Landmark size={16} />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{a.name}</div>
                    <div className="text-xs text-muted">{a.bankName || (a.type === 'cash' ? 'Cash' : '-')}</div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <IconButton icon={Pencil} requires="edit" title="Edit" onClick={() => setEditing(a)} />
                    <IconButton icon={Trash2} tone="danger" requires="full" title="Delete" onClick={() => removeAccount(a.id)} />
                  </div>
                )}
              </div>
              <div className="text-xl font-semibold text-ink mb-3">{Number(a.currentBalance).toFixed(3)} OMR</div>
              {openingPending && Number(a.openingBalance) !== 0 && (
                <div className="-mt-2 mb-3 text-xs rounded-md bg-amber-50 text-amber-800 px-2 py-1.5">
                  Includes opening {Number(a.openingBalance).toFixed(3)} OMR - not in the books until the opening balances
                  (as of {openingPending}) are finalized.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => setViewingTxns(a)}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  View transactions →
                </button>
                {canManage && (
                  <button onClick={() => setReconciling(a)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                    Reconcile
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-3">
        <ArrowLeftRight size={15} />
        Fund Transfers
      </div>
      {transfersLoading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : transfers.length === 0 ? (
        <EmptyState>No fund transfers yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {transfers.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink flex flex-wrap items-center gap-1.5">
                    {accountName(t.fromAccountId)}
                    <ArrowLeftRight size={12} className="text-muted" />
                    {accountName(t.toAccountId)}
                    {t.status === 'in_transit' ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">
                        <Clock size={11} />
                        In Transit
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">
                        <CheckCircle2 size={11} />
                        Completed
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    <span className="whitespace-nowrap">{t.transferNumber}</span> · {t.date}
                    {t.note ? ` · ${t.note}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                  <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(t.amount).toFixed(3)} OMR</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canManage && t.status === 'in_transit' && (
                      <SecondaryButton icon={CheckCircle2} requires="edit" onClick={() => clearTransfer(t.id)}>
                        Mark Received
                      </SecondaryButton>
                    )}
                    <IconButton icon={Eye} title="View" onClick={() => setViewTransfer(t)} />
                    {t.documentFilePath && (
                      <IconButton icon={Upload} title="View document" onClick={() => viewFile(`/fund-transfers/${t.id}/document`)} />
                    )}
                    {canManage && (
                      <>
                        <IconButton icon={Pencil} requires="edit" title="Edit transfer" onClick={() => setEditTransfer(t)} />
                        <IconButton icon={Trash2} tone="danger" requires="full" title="Delete transfer" onClick={() => removeTransfer(t.id)} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showAdd && (
        <AccountModal
          booksStarted={booksStarted}
          openingDate={openingDate}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            loadAccounts();
          }}
        />
      )}
      {editing && (
        <AccountModal
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadAccounts();
          }}
        />
      )}
      {viewingTxns && (
        <TransactionsModal
          account={viewingTxns}
          canManage={!!canManage}
          onClose={() => setViewingTxns(null)}
          onChanged={loadAccounts}
        />
      )}

      {reconciling && <ReconcileModal account={reconciling} onClose={() => setReconciling(null)} onChanged={loadAccounts} />}

      {showAddTransfer && (
        <TransferModal
          accounts={accounts}
          onClose={() => setShowAddTransfer(false)}
          onSaved={() => {
            setShowAddTransfer(false);
            loadAccounts();
            loadTransfers();
          }}
        />
      )}
      {editTransfer && (
        <TransferModal
          transfer={editTransfer}
          accounts={accounts}
          onClose={() => setEditTransfer(null)}
          onSaved={() => {
            setEditTransfer(null);
            loadAccounts();
            loadTransfers();
          }}
        />
      )}
      {viewTransfer && (
        <TransferViewModal transfer={viewTransfer} accountName={accountName} onClose={() => setViewTransfer(null)} />
      )}
    </div>
  );
}

function AccountModal({
  account,
  booksStarted = false,
  openingDate = null,
  onClose,
  onSaved,
}: {
  account?: BankAccount;
  booksStarted?: boolean;
  openingDate?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState<'bank' | 'cash'>(account?.type || 'bank');
  const [bankName, setBankName] = useState(account?.bankName || '');
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber || '');
  const [openingBalance, setOpeningBalance] = useState(account ? String(account.openingBalance) : '0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (account) {
        await api.patch(`/bank-accounts/${account.id}`, {
          name,
          type,
          bankName: bankName || undefined,
          accountNumber: accountNumber || undefined,
        });
      } else {
        await api.post('/bank-accounts', {
          name,
          type,
          bankName: bankName || undefined,
          accountNumber: accountNumber || undefined,
          openingBalance: booksStarted ? 0 : Number(openingBalance) || 0,
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
    <Modal title={account ? 'Edit account' : 'New bank/cash account'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Account name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as 'bank' | 'cash')}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
          </select>
        </Field>
        {type === 'bank' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank name">
              <input className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </Field>
            <Field label="Account number">
              <input className={inputClass} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </Field>
          </div>
        )}
        {!account && booksStarted && (
          <p className="text-xs text-muted">
            The books have started, so a new account starts at 0. Put money in with a dated deposit (View transactions → Add) or a Fund Transfer.
          </p>
        )}
        {!account && !booksStarted && (
          <Field label={openingDate ? `Balance at the end of ${openingDate} (OMR)` : 'Opening balance (OMR)'}>
            <input
              className={inputClass}
              type="number"
              step="0.001"
              min="0"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
            <span className="block text-xs text-muted mt-1">Money already in this account. The other side goes to 3900 Opening Balance Equity (see Opening Balances).</span>
          </Field>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TransactionsModal({
  account,
  canManage,
  onClose,
  onChanged,
}: {
  account: BankAccount;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [txnType, setTxnType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [category, setCategory] = useState('');
  const [txnDate, setTxnDate] = useState(localISODate());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get(`/bank-accounts/${account.id}/transactions`)
      .then((res) => setTransactions(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(load, [account.id]);

  async function addTransaction(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/bank-accounts/${account.id}/transactions`, {
        type: txnType,
        amount: Number(amount),
        note: note || undefined,
        category,
        date: txnDate,
      });
      setShowAddTxn(false);
      setAmount('');
      setNote('');
      setCategory('');
      load();
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not record transaction.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${account.name} — transactions`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted">
            Current balance: <span className="font-semibold text-ink">{Number(account.currentBalance).toFixed(3)} OMR</span>
          </div>
          {canManage && (
            <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddTxn((v) => !v)}>
              Record transaction
            </PrimaryButton>
          )}
        </div>

        {showAddTxn && (
          <form onSubmit={addTransaction} className="border border-black/10 rounded-lg p-3 space-y-3 bg-black/[0.02]">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  className={inputClass}
                  value={txnType}
                  onChange={(e) => {
                    setTxnType(e.target.value as 'deposit' | 'withdrawal');
                    setCategory('');
                  }}
                >
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                </select>
              </Field>
              <Field label="Amount (OMR)">
                <input
                  className={inputClass}
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field label="What is this? (posted to the books)">
              <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} required>
                <option value="">Choose category</option>
                {(txnType === 'deposit' ? DEPOSIT_CATEGORY_OPTIONS : WITHDRAWAL_CATEGORY_OPTIONS).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date">
                <input className={inputClass} type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} required />
              </Field>
              <Field label="Note (optional)">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setShowAddTxn(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted">No transactions yet.</p>
        ) : (
          <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{t.note || (t.type === 'deposit' ? 'Deposit' : 'Withdrawal')}</div>
                  <div className="text-xs text-muted">
                    {new Date(t.date).toLocaleDateString()}
                    {t.category ? ` · ${CATEGORY_LABEL[t.category] || t.category}` : ''}
                  </div>
                </div>
                <div className={`text-sm font-medium whitespace-nowrap ${t.type === 'deposit' ? 'text-brand-700' : 'text-red-600'}`}>
                  {t.type === 'deposit' ? '+' : '-'}
                  {Number(t.amount).toFixed(3)} OMR
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({
  transfer,
  accounts,
  onClose,
  onSaved,
}: {
  transfer?: FundTransfer;
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fromAccountId, setFromAccountId] = useState(transfer?.fromAccountId || accounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(transfer?.toAccountId || accounts[1]?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState(transfer ? String(transfer.amount) : '0');
  const [date, setDate] = useState(transfer?.date || localISODate());
  const [note, setNote] = useState(transfer?.note || '');
  const [inTransit, setInTransit] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (fromAccountId === toAccountId) {
      setError('Source and destination accounts must be different');
      return;
    }
    setBusy(true);
    setError('');
    const payload: Record<string, unknown> = {
      fromAccountId,
      toAccountId,
      amount: Number(amount),
      date,
      note: note || undefined,
    };
    // Only meaningful on create — editing never flips in-transit ↔
    // completed (that only happens via the "Mark Received" action).
    if (!transfer) payload.inTransit = inTransit;
    // set once the record exists: a failing attachment after that must not
    // lead to a second Save creating the record (and moving money) twice
    let created = false;
    try {
      let id = transfer?.id;
      if (transfer) await api.patch(`/fund-transfers/${transfer.id}`, payload);
      else {
        const res = await api.post('/fund-transfers', payload);
        id = res.data.id;
        created = true;
      }
      // Uploaded right after the transfer exists (backend requires the
      // record's id first) — same two-step flow Expense/Reimbursement use.
      if (documentFile && id) {
        const formData = new FormData();
        formData.append('file', documentFile);
        await api.post(`/fund-transfers/${id}/document`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      if (created) {
        window.alert(`The transfer was saved, but its document could not be uploaded: ${err?.response?.data?.message || 'unknown error'}. Open it again (Edit) to add it.`);
        onSaved();
        return;
      }
      setError(err?.response?.data?.message || `Could not ${transfer ? 'update' : 'save'} this transfer.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={transfer ? 'Edit fund transfer' : 'Transfer fund'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="From account">
            <select className={inputClass} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({Number(a.currentBalance).toFixed(3)} OMR)
                </option>
              ))}
            </select>
          </Field>
          <Field label="To account">
            <select className={inputClass} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({Number(a.currentBalance).toFixed(3)} OMR)
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {!transfer ? (
          <label className="flex items-start gap-2 text-sm text-ink/80 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={inTransit}
              onChange={(e) => setInTransit(e.target.checked)}
            />
            <span>
              Money is still in transit (not cleared yet) — the source account is debited now, but the destination account
              won't be credited until you mark it received.
            </span>
          </label>
        ) : (
          transfer.status === 'in_transit' && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              This transfer is still in transit — editing here only changes the source-side withdrawal. Use "Mark Received" on
              the list to credit the destination account once the money arrives.
            </p>
          )
        )}
        <Field label={transfer?.documentFilePath ? 'Replace document (optional)' : 'Document (optional)'}>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={inputClass}
            onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : transfer ? 'Save' : 'Transfer'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TransferViewModal({
  transfer,
  accountName,
  onClose,
}: {
  transfer: FundTransfer;
  accountName: (id: string) => string;
  onClose: () => void;
}) {
  return (
    <Modal title="Fund transfer" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Reference</span>
          <span className="text-ink font-medium">{transfer.transferNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">From</span>
          <span className="text-ink font-medium">{accountName(transfer.fromAccountId)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">To</span>
          <span className="text-ink font-medium">{accountName(transfer.toAccountId)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Amount</span>
          <span className="text-ink font-medium">{Number(transfer.amount).toFixed(3)} OMR</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Date</span>
          <span className="text-ink font-medium">{transfer.date}</span>
        </div>
        {transfer.note && (
          <div className="flex justify-between gap-4">
            <span className="text-muted">Note</span>
            <span className="text-ink font-medium text-right">{transfer.note}</span>
          </div>
        )}
        {transfer.documentFilePath && (
          <div className="pt-2">
            <SecondaryButton icon={Eye} onClick={() => viewFile(`/fund-transfers/${transfer.id}/document`)}>
              View document
            </SecondaryButton>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

interface RecLine {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  date: string;
  note?: string;
  category?: string | null;
}
interface RecPrepare {
  lastReconciliation: { id: string; statementDate: string; statementBalance: number } | null;
  openingBalance: number;
  bookBalance: number;
  transactions: RecLine[];
  laterUnreconciled: number;
}
interface RecDone {
  id: string;
  statementDate: string;
  statementBalance: number;
  openingBalance: number;
  bookBalance: number;
  inTransit: number;
  lineCount: number;
  createdByEmail?: string | null;
  problems: string[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Bank Reconciliation: tick the ERP lines that appear on the bank
// statement; it can be saved only when previous statement balance + ticked
// lines = the new statement's closing balance.
function ReconcileModal({ account, onClose, onChanged }: { account: BankAccount; onClose: () => void; onChanged: () => void }) {
  const [history, setHistory] = useState<RecDone[]>([]);
  const [statementDate, setStatementDate] = useState(localISODate());
  const [statementBalance, setStatementBalance] = useState('');
  const [prep, setPrep] = useState<RecPrepare | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function loadHistory() {
    api.get(`/bank-accounts/${account.id}/reconciliations`).then((res) => setHistory(res.data)).catch(() => {});
  }
  useEffect(loadHistory, [account.id]);

  async function load() {
    setError('');
    setPrep(null);
    setTicked(new Set());
    try {
      const res = await api.get(`/bank-accounts/${account.id}/reconciliation`, { params: { statementDate } });
      setPrep(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not load the lines.');
    }
  }

  const cleared = prep
    ? r3(prep.openingBalance + prep.transactions.filter((t) => ticked.has(t.id)).reduce((s, t) => s + (t.type === 'deposit' ? t.amount : -t.amount), 0))
    : 0;
  const stmt = Number(statementBalance);
  const hasStmt = statementBalance.trim() !== '' && Number.isFinite(stmt);
  const difference = hasStmt ? r3(stmt - cleared) : null;
  const balanced = difference !== null && Math.abs(difference) < 0.0005;

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function complete() {
    if (!prep || !balanced) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/bank-accounts/${account.id}/reconciliations`, {
        statementDate,
        statementBalance: stmt,
        transactionIds: [...ticked],
      });
      setPrep(null);
      setStatementBalance('');
      setTicked(new Set());
      loadHistory();
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save the reconciliation.');
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    if (!window.confirm('Undo this reconciliation? Its lines become unticked again.')) return;
    try {
      await api.delete(`/bank-accounts/reconciliations/${id}`);
      loadHistory();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not undo.');
    }
  }

  return (
    <Modal title={`Reconcile - ${account.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Statement date">
            <input type="date" className={inputClass} value={statementDate} onChange={(e) => { setStatementDate(e.target.value); setPrep(null); }} />
          </Field>
          <Field label="Closing balance on statement (OMR)">
            <input
              type="number"
              step="0.001"
              className={inputClass}
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              placeholder="0.000"
            />
          </Field>
          <SecondaryButton onClick={load}>Load lines</SecondaryButton>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {prep && (
          <>
            <div className="text-xs text-muted">
              {prep.lastReconciliation
                ? `Starts from the ${prep.lastReconciliation.statementDate} statement: ${prep.openingBalance.toFixed(3)} OMR.`
                : `First reconciliation - starts from the account's opening balance: ${prep.openingBalance.toFixed(3)} OMR.`}{' '}
              Tick every line that appears on the bank statement.
            </div>
            {prep.transactions.length === 0 ? (
              <EmptyState>No unreconciled lines up to this date.</EmptyState>
            ) : (
              <div className="border border-black/10 rounded-lg max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-2 border-b border-black/10 bg-black/[0.02] text-xs">
                  <span className="text-muted">{ticked.size} of {prep.transactions.length} ticked</span>
                  <button
                    type="button"
                    className="font-medium text-brand-600 hover:text-brand-700"
                    onClick={() =>
                      setTicked(ticked.size === prep.transactions.length ? new Set() : new Set(prep.transactions.map((t) => t.id)))
                    }
                  >
                    {ticked.size === prep.transactions.length ? 'Untick all' : 'Tick all'}
                  </button>
                </div>
                <div className="divide-y divide-black/5">
                  {prep.transactions.map((t) => (
                    <label key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-black/[0.02]">
                      <input type="checkbox" checked={ticked.has(t.id)} onChange={() => toggle(t.id)} />
                      <span className="w-24 shrink-0 text-xs text-muted">{t.date}</span>
                      <span className="flex-1 min-w-0 truncate text-ink">{t.note || (t.category ? CATEGORY_LABEL[t.category] || t.category : '-')}</span>
                      <span className={`shrink-0 font-medium whitespace-nowrap ${t.type === 'deposit' ? 'text-green-700' : 'text-red-600'}`}>
                        {t.type === 'deposit' ? '+' : '-'}
                        {t.amount.toFixed(3)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {prep.laterUnreconciled > 0 && (
              <div className="text-xs text-muted">{prep.laterUnreconciled} unreconciled line(s) dated after the statement date are not shown.</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div className="rounded-lg bg-black/[0.03] px-3 py-2">
                <div className="text-xs text-muted">Ticked balance</div>
                <div className="font-semibold text-ink">{cleared.toFixed(3)}</div>
              </div>
              <div className="rounded-lg bg-black/[0.03] px-3 py-2">
                <div className="text-xs text-muted">Statement</div>
                <div className="font-semibold text-ink">{hasStmt ? stmt.toFixed(3) : '-'}</div>
              </div>
              <div className={`rounded-lg px-3 py-2 ${balanced ? 'bg-green-50' : 'bg-amber-50'}`}>
                <div className="text-xs text-muted">Difference</div>
                <div className={`font-semibold ${balanced ? 'text-green-700' : 'text-amber-800'}`}>{difference === null ? '-' : difference.toFixed(3)}</div>
              </div>
              <div className="rounded-lg bg-black/[0.03] px-3 py-2">
                <div className="text-xs text-muted">ERP balance on date</div>
                <div className="font-semibold text-ink">{prep.bookBalance.toFixed(3)}</div>
              </div>
            </div>
            {!balanced && hasStmt && (
              <div className="text-xs text-amber-800">
                Not balanced yet. Tick the missing lines - or add bank charges / interest that are on the statement but not yet in the ERP
                (View transactions → Add).
              </div>
            )}
            <div className="flex justify-end">
              <PrimaryButton requires="edit" disabled={!balanced || busy} onClick={complete}>
                {busy ? 'Saving…' : 'Complete reconciliation'}
              </PrimaryButton>
            </div>
          </>
        )}

        <div>
          <div className="text-sm font-semibold text-ink mb-2">Reconciled statements</div>
          {history.length === 0 ? (
            <div className="text-sm text-muted">None yet.</div>
          ) : (
            <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
              {history.map((h, i) => (
                <div key={h.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-ink">{h.statementDate}</span>
                      <span className="text-muted"> · {h.statementBalance.toFixed(3)} OMR · {h.lineCount} line(s)</span>
                      {Math.abs(h.inTransit) > 0.0005 && <span className="text-muted"> · in transit {h.inTransit.toFixed(3)}</span>}
                    </div>
                    {i === 0 && (
                      <button type="button" className="text-xs font-medium text-red-600 hover:text-red-700" onClick={() => undo(h.id)}>
                        Undo
                      </button>
                    )}
                  </div>
                  {h.problems.length > 0 && (
                    <div className="mt-1 text-xs text-red-600">Changed after reconciling: {h.problems.join('; ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
