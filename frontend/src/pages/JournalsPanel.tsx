import { FormEvent, useEffect, useState } from 'react';
import { Plus, BookOpen, Landmark, Scale, Trash2, Pencil, Ban } from 'lucide-react';
import api from '../api/client';
import {
  PrimaryButton,
  SecondaryButton,
  IconButton,
  Pill,
  Card,
  EmptyState,
  Modal,
  Field,
  inputClass,
} from '../components/ui';

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
];

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label || value;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  description?: string;
  active: boolean;
}

interface JournalEntryLine {
  id?: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description?: string;
}

interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  reference?: string;
  memo: string;
  lines: JournalEntryLine[];
  createdAt: string;
  // Set on entries posted automatically from Expense/Invoice/
  // Reimbursement/Fund Transfer/Tax Payment — these can't be edited or
  // deleted directly here (backend rejects it); the source record must
  // be edited/deleted instead, which re-posts or removes this entry.
  autoPosted?: boolean;
  sourceType?: string;
}

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

type JournalsTab = 'entries' | 'accounts' | 'trial-balance';

// Full Double-Entry Journal — Chart of Accounts + Journal Entries + Trial
// Balance, rendered inside Accounting.tsx's "Journals" tab. This is a
// manual bookkeeping tool alongside (not replacing) Expenses/Reimbursements
// — for adjusting entries, opening balances, depreciation, corrections.
export default function JournalsPanel() {
  const [subTab, setSubTab] = useState<JournalsTab>('entries');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [showAddEntry, setShowAddEntry] = useState(false);

  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [trialBalanceLoading, setTrialBalanceLoading] = useState(true);

  function loadAccounts() {
    setAccountsLoading(true);
    api
      .get('/accounts', { params: { includeInactive: true } })
      .then((res) => setAccounts(res.data))
      .finally(() => setAccountsLoading(false));
  }

  function loadEntries() {
    setEntriesLoading(true);
    api
      .get('/journal-entries')
      .then((res) => setEntries(res.data))
      .finally(() => setEntriesLoading(false));
  }

  function loadTrialBalance() {
    setTrialBalanceLoading(true);
    api
      .get('/journal-entries/trial-balance')
      .then((res) => setTrialBalance(res.data))
      .finally(() => setTrialBalanceLoading(false));
  }

  useEffect(loadAccounts, []);
  useEffect(() => {
    if (subTab === 'entries') loadEntries();
    if (subTab === 'trial-balance') loadTrialBalance();
  }, [subTab]);

  const activeAccounts = accounts.filter((a) => a.active);

  async function removeEntry(id: string) {
    if (!window.confirm('Delete this journal entry? This cannot be undone.')) return;
    try {
      await api.delete(`/journal-entries/${id}`);
      loadEntries();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this entry.');
    }
  }

  async function deactivateAccount(id: string) {
    if (!window.confirm('Deactivate this account? It will no longer appear when creating new journal entries.')) return;
    try {
      await api.delete(`/accounts/${id}`);
      loadAccounts();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not deactivate this account.');
    }
  }

  function accountLabel(id: string) {
    const acc = accounts.find((a) => a.id === id);
    return acc ? `${acc.code} · ${acc.name}` : id;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Pill
          value={subTab}
          onChange={(v) => setSubTab(v as JournalsTab)}
          options={[
            { value: 'entries', label: 'Journal Entries' },
            { value: 'accounts', label: 'Chart of Accounts' },
            { value: 'trial-balance', label: 'Trial Balance' },
          ]}
        />
        {subTab === 'entries' && (
          <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddEntry(true)}>
            New journal entry
          </PrimaryButton>
        )}
        {subTab === 'accounts' && (
          <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddAccount(true)}>
            Add account
          </PrimaryButton>
        )}
      </div>

      {subTab === 'entries' && (
        <>
          {entriesLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : entries.length === 0 ? (
            <EmptyState>No journal entries yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {entries.map((entry) => {
                  const total = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
                  return (
                    <div key={entry.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                            <BookOpen size={14} className="text-muted" />
                            {entry.memo}
                          </div>
                          <div className="text-xs text-muted">
                            {entry.entryNumber} · {entry.date}
                            {entry.reference ? ` · Ref: ${entry.reference}` : ''}
                            {entry.autoPosted ? ` · Auto-posted from ${entry.sourceType?.replace('_', ' ') || 'another record'}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-semibold text-ink">{total.toFixed(3)} OMR</div>
                          {entry.autoPosted ? (
                            <span className="text-xs px-2 py-1 rounded-full font-medium bg-black/5 text-ink/70">Auto-posted</span>
                          ) : (
                            <IconButton icon={Trash2} tone="danger" requires="full" title="Delete entry" onClick={() => removeEntry(entry.id)} />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 ml-5 space-y-1">
                        {entry.lines.map((line, idx) => (
                          <div key={line.id || idx} className="flex items-center justify-between text-xs text-ink/70">
                            <span>
                              {accountLabel(line.accountId)}
                              {line.description ? ` — ${line.description}` : ''}
                            </span>
                            <span className="font-mono">
                              {Number(line.debit) > 0 ? `Dr ${Number(line.debit).toFixed(3)}` : `Cr ${Number(line.credit).toFixed(3)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {showAddEntry && (
            <JournalEntryModal
              accounts={activeAccounts}
              onClose={() => setShowAddEntry(false)}
              onSaved={() => {
                setShowAddEntry(false);
                loadEntries();
              }}
            />
          )}
        </>
      )}

      {subTab === 'accounts' && (
        <>
          {accountsLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : accounts.length === 0 ? (
            <EmptyState>No accounts yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {accounts.map((acc) => (
                  <div key={acc.id} className={`flex items-center justify-between px-4 py-3 ${!acc.active ? 'opacity-50' : ''}`}>
                    <div>
                      <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                        <Landmark size={14} className="text-muted" />
                        {acc.code} · {acc.name}
                        {!acc.active && <span className="text-xs text-muted">(inactive)</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {labelFor(ACCOUNT_TYPE_OPTIONS, acc.type)}
                        {acc.description ? ` · ${acc.description}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <IconButton icon={Pencil} requires="edit" title="Edit account" onClick={() => setEditAccount(acc)} />
                      {acc.active && (
                        <IconButton icon={Ban} tone="danger" requires="full" title="Deactivate account" onClick={() => deactivateAccount(acc.id)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {showAddAccount && (
            <AccountModal
              onClose={() => setShowAddAccount(false)}
              onSaved={() => {
                setShowAddAccount(false);
                loadAccounts();
              }}
            />
          )}
          {editAccount && (
            <AccountModal
              account={editAccount}
              onClose={() => setEditAccount(null)}
              onSaved={() => {
                setEditAccount(null);
                loadAccounts();
              }}
            />
          )}
        </>
      )}

      {subTab === 'trial-balance' && (
        <>
          {trialBalanceLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : !trialBalance || trialBalance.rows.length === 0 ? (
            <EmptyState>No journal entries posted yet — the Trial Balance will fill in as entries are added.</EmptyState>
          ) : (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Scale size={15} />
                  Trial Balance
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${trialBalance.balanced ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
                  {trialBalance.balanced ? 'Balanced' : 'Out of balance'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-black/10">
                      <th className="py-2 pr-3 font-medium">Account</th>
                      <th className="py-2 px-3 font-medium">Type</th>
                      <th className="py-2 px-3 font-medium text-right">Debit</th>
                      <th className="py-2 px-3 font-medium text-right">Credit</th>
                      <th className="py-2 pl-3 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {trialBalance.rows.map((r) => (
                      <tr key={r.accountId}>
                        <td className="py-2 pr-3 text-ink font-medium">{r.code} · {r.name}</td>
                        <td className="py-2 px-3 text-ink/70">{labelFor(ACCOUNT_TYPE_OPTIONS, r.type)}</td>
                        <td className="py-2 px-3 text-right text-ink/70">{r.debit > 0 ? r.debit.toFixed(3) : '-'}</td>
                        <td className="py-2 px-3 text-right text-ink/70">{r.credit > 0 ? r.credit.toFixed(3) : '-'}</td>
                        <td className="py-2 pl-3 text-right font-semibold text-ink">{r.balance.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/10 font-semibold text-ink">
                      <td className="py-2 pr-3" colSpan={2}>Total</td>
                      <td className="py-2 px-3 text-right">{trialBalance.totalDebit.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right">{trialBalance.totalCredit.toFixed(3)}</td>
                      <td className="py-2 pl-3 text-right">—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account?: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(account?.code || '');
  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState(account?.type || ACCOUNT_TYPE_OPTIONS[0].value);
  const [description, setDescription] = useState(account?.description || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { code, name, type, description: description || undefined };
      if (account) await api.patch(`/accounts/${account.id}`, payload);
      else await api.post('/accounts', payload);
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? 'Edit account' : 'Add account'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {ACCOUNT_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
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

interface DraftLine {
  accountId: string;
  side: 'debit' | 'credit';
  amount: string;
  description: string;
}

function emptyLine(accounts: Account[]): DraftLine {
  return { accountId: accounts[0]?.id || '', side: 'debit', amount: '', description: '' };
}

function JournalEntryModal({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(accounts), emptyLine(accounts)]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const totalDebit = lines.reduce((sum, l) => sum + (l.side === 'debit' ? Number(l.amount) || 0 : 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.side === 'credit' ? Number(l.amount) || 0 : 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.001;

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(accounts)]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!balanced) {
      setError('Total debit must equal total credit before this entry can be saved.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/journal-entries', {
        date,
        reference: reference || undefined,
        memo,
        lines: lines
          .filter((l) => Number(l.amount) > 0)
          .map((l) => ({
            accountId: l.accountId,
            debit: l.side === 'debit' ? Number(l.amount) : undefined,
            credit: l.side === 'credit' ? Number(l.amount) : undefined,
            description: l.description || undefined,
          })),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this journal entry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New journal entry" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Reference (optional)">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice #, cheque #…" />
          </Field>
        </div>
        <Field label="Memo">
          <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} required />
        </Field>

        <div>
          <span className="block text-xs font-medium text-muted mb-1">Lines</span>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1`}
                  value={line.accountId}
                  onChange={(e) => updateLine(idx, { accountId: e.target.value })}
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
                <select
                  className={`${inputClass} w-28`}
                  value={line.side}
                  onChange={(e) => updateLine(idx, { side: e.target.value as 'debit' | 'credit' })}
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                <input
                  className={`${inputClass} w-32`}
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(e) => updateLine(idx, { amount: e.target.value })}
                  required
                />
                <input
                  className={`${inputClass} flex-1`}
                  placeholder="Description (optional)"
                  value={line.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                />
                <IconButton
                  icon={Trash2}
                  tone="danger"
                  title="Remove line"
                  onClick={() => removeLine(idx)}
                />
              </div>
            ))}
          </div>
          <SecondaryButton icon={Plus} className="mt-2" onClick={addLine}>
            Add line
          </SecondaryButton>
        </div>

        <div className={`text-sm rounded-lg p-3 flex items-center justify-between ${balanced ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'}`}>
          <span>Total Debit: {totalDebit.toFixed(3)} OMR</span>
          <span>Total Credit: {totalCredit.toFixed(3)} OMR</span>
          <span className="font-medium">{balanced ? 'Balanced' : 'Not balanced'}</span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy || !balanced || lines.length < 2}>
            {busy ? 'Saving…' : 'Save entry'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
