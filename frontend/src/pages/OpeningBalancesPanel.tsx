import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, EmptyState, Field, IconButton, Modal, Pill, PrimaryButton, SecondaryButton, inputClass } from '../components/ui';
import { quantityInputMin, quantityInputStep, unitLabel } from '../utils/formatQuantity';

interface BankRow {
  bankAccountId: string;
  name: string;
  type: string;
  lineId: string | null;
  amount: number;
  fromAccountSetup: boolean;
  openedLater?: boolean;
}
interface DocRow {
  id: string;
  partyId: string;
  partyName: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string | null;
  amount: number;
  note: string | null;
}
interface StockRow {
  itemId: string;
  name: string;
  unit: string;
  currentStock: number;
  currentCost: number;
  lineId: string | null;
  quantity: number | null;
  unitCost: number | null;
  value: number | null;
}
interface AccountRow {
  id: string;
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  note: string | null;
}
interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}
interface Overview {
  openingBalanceDate: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  banks: BankRow[];
  customers: DocRow[];
  suppliers: DocRow[];
  rawMaterials: StockRow[];
  finishedGoods: StockRow[];
  accounts: AccountRow[];
  accountOptions: AccountOption[];
  summary: {
    bank: number;
    customers: number;
    suppliers: number;
    rawMaterials: number;
    finishedGoods: number;
    otherDebit: number;
    otherCredit: number;
    totalDebit: number;
    totalCredit: number;
    openingBalanceEquity: number;
  };
  blockers: { what: string; count: number }[];
  warnings: string[];
}
interface Party {
  id: string;
  name: string;
}

type Section = 'bank' | 'customers' | 'suppliers' | 'stock' | 'accounts';

function money(n: number | string | null | undefined) {
  return Number(n || 0).toFixed(3);
}

function errText(err: any, fallback: string) {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m || fallback;
}

// Accounting > Opening Balances: the closing figures of the old books,
// typed in as draft lines, then finalized once (see backend
// opening-balance.service.ts for what finalize creates).
export default function OpeningBalancesPanel() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [data, setData] = useState<Overview | null>(null);
  const [section, setSection] = useState<Section>('bank');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [docModal, setDocModal] = useState<{ kind: 'customer' | 'supplier'; row?: DocRow } | null>(null);
  const [accountModal, setAccountModal] = useState<{ row?: AccountRow } | null>(null);
  const [showFinalize, setShowFinalize] = useState(false);
  // rows with figures typed but not saved yet (key -> name): Finalize and
  // switching sections wait for them, so nothing typed is silently dropped
  const [unsaved, setUnsaved] = useState<Record<string, string>>({});
  const markUnsaved = useCallback((key: string, name: string, isDirty: boolean) => {
    setUnsaved((prev) => {
      if (isDirty === !!prev[key]) return prev;
      const next = { ...prev };
      if (isDirty) next[key] = name;
      else delete next[key];
      return next;
    });
  }, []);
  const unsavedNames = Object.values(unsaved);

  const load = useCallback(async () => {
    const res = await api.get('/opening-balances');
    setData(res.data);
    setDateInput(res.data.openingBalanceDate || '');
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errText(err, 'Could not load opening balances.')));
    api.get('/customers').then((r) => setCustomers(r.data)).catch(() => {});
    api.get('/suppliers').then((r) => setSuppliers(r.data)).catch(() => {});
  }, [load]);

  const finalized = !!data?.finalizedAt;
  const editable = canManage && !finalized && !!data?.openingBalanceDate;

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(errText(err, 'Could not save.'));
      return false;
    }
  }

  const saveLine = (body: Record<string, unknown>, id?: string | null) =>
    id ? api.patch(`/opening-balances/lines/${id}`, body) : api.post('/opening-balances/lines', body);

  if (!data) {
    return <div className="text-sm text-muted">{error || 'Loading…'}</div>;
  }
  const s = data.summary;

  return (
    <div className="space-y-4">
      {/* date + status */}
      <Card className="p-4">
        {finalized ? (
          <div className="flex items-start gap-3">
            <Lock size={18} className="text-brand-700 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-semibold text-ink">Opening balances are finalized as of {data.openingBalanceDate}.</div>
              <div className="text-muted mt-0.5">
                Finalized {new Date(data.finalizedAt!).toLocaleString('en-GB')} by {data.finalizedBy || 'unknown'}. The books up to {data.openingBalanceDate}{' '}
                are closed - corrections are made with a journal entry dated after it.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-sm">
              <div className="font-semibold text-ink">Opening balance date</div>
              <div className="text-muted mt-0.5 max-w-xl">
                The last day of the old books. Enter every balance as it was at the end of this day. After you finalize, nothing can be recorded on or before it.
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="w-44">
                <input type="date" className={inputClass} value={dateInput} onChange={(e) => setDateInput(e.target.value)} disabled={!canManage} />
              </div>
              {canManage && (
                <PrimaryButton
                  icon={Save}
                  disabled={!dateInput || dateInput === data.openingBalanceDate}
                  onClick={() => run(() => api.put('/opening-balances/date', { openingBalanceDate: dateInput }), 'Date saved.')}
                >
                  Save date
                </PrimaryButton>
              )}
            </div>
          </div>
        )}
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-brand-400 bg-brand-50 px-4 py-2 text-sm text-brand-700">{notice}</div>}

      {!data.openingBalanceDate ? (
        <EmptyState>Set the opening balance date first.</EmptyState>
      ) : (
        <>
          {/* check */}
          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm flex-1">
                <Total label="Bank & cash" value={s.bank} />
                <Total label="Customers owe" value={s.customers} />
                <Total label="Stock" value={s.rawMaterials + s.finishedGoods} />
                <Total label="Other (Dr)" value={s.otherDebit} />
                <Total label="Suppliers owed" value={s.suppliers} />
                <Total label="Other (Cr)" value={s.otherCredit} />
                <Total label="Total debits" value={s.totalDebit} strong />
                <Total label="Total credits" value={s.totalCredit} strong />
              </div>
              <div className="rounded-lg bg-cream px-4 py-3 text-sm lg:w-72">
                <div className="text-muted text-xs">3900 Opening Balance Equity (balancing line)</div>
                <div className="text-lg font-semibold text-ink">
                  {money(Math.abs(s.openingBalanceEquity))} {s.openingBalanceEquity >= 0 ? 'Cr' : 'Dr'}
                </div>
                <div className="text-xs text-muted mt-1">
                  = the company's equity on the opening date. After finalizing, move it to Capital / Retained Earnings with a journal entry.
                </div>
              </div>
            </div>
            {!finalized && data.blockers.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={14} /> Cannot finalize yet - the books already have entries (test data?). Delete these first:
                </div>
                <div className="mt-1">{data.blockers.map((b) => `${b.count} ${b.what}`).join(' · ')}</div>
              </div>
            )}
            {!finalized &&
              data.warnings.map((w) => (
                <div key={w} className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={14} className="shrink-0 mt-px" /> {w}
                </div>
              ))}
            {!finalized && canManage && (
              <div className="mt-3 flex justify-end">
                <PrimaryButton icon={CheckCircle2} disabled={data.blockers.length > 0 || unsavedNames.length > 0} onClick={() => setShowFinalize(true)}>
                  Finalize opening balances
                </PrimaryButton>
              </div>
            )}
            {!finalized && unsavedNames.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={14} className="shrink-0 mt-px" /> Not saved yet: {unsavedNames.join(', ')}. Press Save on each row (or clear it) before finalizing.
              </div>
            )}
          </Card>

          <Pill
            value={section}
            onChange={(v) => {
              if (unsavedNames.length) {
                setError(`Save these rows first (or clear what you typed): ${unsavedNames.join(', ')}.`);
                return;
              }
              setSection(v as Section);
            }}
            options={[
              { value: 'bank', label: 'Bank & Cash' },
              { value: 'customers', label: `Customers (${data.customers.length})` },
              { value: 'suppliers', label: `Suppliers (${data.suppliers.length})` },
              { value: 'stock', label: 'Stock' },
              { value: 'accounts', label: `Other accounts (${data.accounts.length})` },
            ]}
          />

          {section === 'bank' && (
            <Card className="divide-y divide-black/5">
              <SectionHelp>
                The balance of each bank and cash account on {data.openingBalanceDate}, as on the bank statement / cash count. An overdraft goes under Other accounts
                (e.g. 2400 Short-term Loans) with 0 here.
              </SectionHelp>
              {data.banks.length === 0 && <div className="p-4 text-sm text-muted">No bank or cash accounts yet - add them on Accounting &gt; Accounts first.</div>}
              {data.banks.map((b) => (
                <BankLine
                  key={b.bankAccountId}
                  row={b}
                  editable={editable}
                  onDirtyChange={(d) => markUnsaved(`bank:${b.bankAccountId}`, b.name, d)}
                  onSave={(amount) => run(() => saveLine({ kind: 'bank', refId: b.bankAccountId, amount }, b.lineId), `${b.name} saved.`)} />
              ))}
            </Card>
          )}

          {(section === 'customers' || section === 'suppliers') && (
            <DocSection
              kind={section === 'customers' ? 'customer' : 'supplier'}
              rows={section === 'customers' ? data.customers : data.suppliers}
              editable={editable}
              date={data.openingBalanceDate}
              onAdd={() => setDocModal({ kind: section === 'customers' ? 'customer' : 'supplier' })}
              onEdit={(row) => setDocModal({ kind: section === 'customers' ? 'customer' : 'supplier', row })}
              onDelete={(row) => run(() => api.delete(`/opening-balances/lines/${row.id}`), 'Line removed.')}
            />
          )}

          {section === 'stock' && (
            <div className="space-y-4">
              <SectionHelp card>
                Quantity on hand on {data.openingBalanceDate} and what one unit cost you (purchase or production cost, without VAT). This replaces the stock typed in
                before. Items you leave empty keep their current quantity at no value.
              </SectionHelp>
              {[
                { title: 'Raw materials', kind: 'raw_material', rows: data.rawMaterials },
                { title: 'Finished goods', kind: 'finished_good', rows: data.finishedGoods },
              ].map((grp) => (
                <Card key={grp.kind} className="divide-y divide-black/5">
                  <div className="px-4 py-2.5 text-sm font-semibold text-ink">{grp.title}</div>
                  {grp.rows.length === 0 && <div className="p-4 text-sm text-muted">None yet.</div>}
                  {grp.rows.map((r) => (
                    <StockLine
                      key={r.itemId}
                      row={r}
                      editable={editable}
                      onDirtyChange={(d) => markUnsaved(`${grp.kind}:${r.itemId}`, r.name, d)}
                      onSave={(quantity, unitCost) => run(() => saveLine({ kind: grp.kind, refId: r.itemId, quantity, unitCost }, r.lineId), `${r.name} saved.`)}
                      onClear={() => run(() => api.delete(`/opening-balances/lines/${r.lineId}`), `${r.name} cleared.`)}
                    />
                  ))}
                </Card>
              ))}
            </div>
          )}

          {section === 'accounts' && (
            <Card>
              <SectionHelp>
                Everything else on the old balance sheet: fixed assets (at cost) and accumulated depreciation, loans, VAT payable / receivable, prepaid and accrued
                items, share capital, retained earnings. Customers, suppliers, stock and bank accounts have their own sections. Income and expense accounts have no opening
                balance - last year's profit is part of Retained Earnings.
              </SectionHelp>
              {editable && (
                <div className="px-4 pb-3">
                  <PrimaryButton icon={Plus} onClick={() => setAccountModal({})}>
                    Add account balance
                  </PrimaryButton>
                </div>
              )}
              {data.accounts.length === 0 ? (
                <div className="px-4 pb-4 text-sm text-muted">No other balances yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-left text-xs text-muted border-y border-black/10 bg-black/[0.02]">
                        <th className="py-2 px-4 font-medium">Account</th>
                        <th className="py-2 px-3 font-medium text-right">Debit</th>
                        <th className="py-2 px-3 font-medium text-right">Credit</th>
                        <th className="py-2 px-3 font-medium">Note</th>
                        <th className="py-2 px-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {data.accounts.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2 px-4 text-ink">
                            {a.code} {a.name}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">{a.debit ? money(a.debit) : ''}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">{a.credit ? money(a.credit) : ''}</td>
                          <td className="py-2 px-3 text-muted">{a.note}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {editable && (
                              <>
                                <IconButton icon={Pencil} title="Edit" onClick={() => setAccountModal({ row: a })} />
                                <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => run(() => api.delete(`/opening-balances/lines/${a.id}`), 'Line removed.')} />
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {docModal && (
        <DocModal
          kind={docModal.kind}
          row={docModal.row}
          parties={docModal.kind === 'customer' ? customers : suppliers}
          maxDate={data.openingBalanceDate || ''}
          onClose={() => setDocModal(null)}
          onSave={async (body) => {
            const ok = await run(() => saveLine({ kind: docModal.kind, ...body }, docModal.row?.id), docModal.kind === 'customer' ? 'Invoice saved.' : 'Bill saved.');
            if (ok) setDocModal(null);
            return ok;
          }}
          error={error}
        />
      )}
      {accountModal && (
        <AccountModal
          row={accountModal.row}
          options={data.accountOptions}
          onClose={() => setAccountModal(null)}
          error={error}
          onSave={async (body) => {
            const ok = await run(() => saveLine({ kind: 'account', ...body }, accountModal.row?.id), 'Account balance saved.');
            if (ok) setAccountModal(null);
            return ok;
          }}
        />
      )}
      {showFinalize && (
        <FinalizeModal
          data={data}
          onClose={() => setShowFinalize(false)}
          onConfirm={async () => {
            const ok = await run(() => api.post('/opening-balances/finalize'), 'Opening balances finalized and posted.');
            if (ok) setShowFinalize(false);
          }}
          error={error}
        />
      )}
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`${strong ? 'font-semibold' : ''} text-ink`}>{money(value)}</div>
    </div>
  );
}

function SectionHelp({ children, card }: { children: ReactNode; card?: boolean }) {
  const p = <p className="px-4 py-3 text-xs text-muted">{children}</p>;
  return card ? <Card>{p}</Card> : p;
}

function BankLine({
  row,
  editable,
  onSave,
  onDirtyChange,
}: {
  row: BankRow;
  editable: boolean;
  onSave: (amount: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(String(row.amount));
  useEffect(() => setValue(String(row.amount)), [row.amount]);
  const changed = Number(value) !== Number(row.amount) || (!row.lineId && Number(value) !== 0);
  const dirty = editable && !row.openedLater && value !== '' && changed;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{row.name}</div>
        <div className="text-xs text-muted">
          {row.type === 'cash' ? 'Cash' : 'Bank'}
          {row.fromAccountSetup && ' · amount typed when the account was created - save to confirm'}
          {row.openedLater && ' · opened after the opening date - not part of the opening balances'}
        </div>
      </div>
      {editable ? (
        <div className="flex items-center gap-2">
          <div className="w-36">
            <input type="number" min="0" step="0.001" className={`${inputClass} text-right`} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <SecondaryButton icon={Save} disabled={!changed || value === '' || Number(value) < 0} onClick={() => onSave(Number(value))}>
            Save
          </SecondaryButton>
        </div>
      ) : (
        <div className="text-sm font-medium text-ink">{row.openedLater ? '-' : money(row.amount)}</div>
      )}
    </div>
  );
}

function StockLine({
  row,
  editable,
  onSave,
  onClear,
  onDirtyChange,
}: {
  row: StockRow;
  editable: boolean;
  onSave: (quantity: number, unitCost: number) => void;
  onClear: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [qty, setQty] = useState(row.quantity != null ? String(row.quantity) : '');
  const [cost, setCost] = useState(row.unitCost != null ? String(row.unitCost) : row.currentCost ? String(row.currentCost) : '');
  useEffect(() => {
    setQty(row.quantity != null ? String(row.quantity) : '');
    setCost(row.unitCost != null ? String(row.unitCost) : row.currentCost ? String(row.currentCost) : '');
  }, [row.quantity, row.unitCost, row.currentCost]);
  const value = Math.round(Number(qty || 0) * Number(cost || 0) * 1000) / 1000;
  const changed = !row.lineId || Number(qty) !== Number(row.quantity) || Number(cost) !== Number(row.unitCost);
  // typed a quantity that isn't saved yet
  const dirty = editable && qty !== '' && Number(qty) > 0 && changed;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-40">
        <div className="text-sm font-medium text-ink">{row.name}</div>
        <div className="text-xs text-muted">
          Now in the ERP: {row.currentStock} {unitLabel(row.unit)}
          {row.lineId && <span className="text-brand-700"> · opening line saved</span>}
        </div>
      </div>
      {editable ? (
        <div className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto">
          <label className="text-xs text-muted sm:w-28">
            Qty ({unitLabel(row.unit)})
            <input
              type="number"
              className={`${inputClass} text-right`}
              min={quantityInputMin(row.unit)}
              step={quantityInputStep(row.unit)}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted sm:w-28">
            Cost / unit
            <input type="number" className={`${inputClass} text-right`} min="0" step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
          <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
            <div className="text-xs text-muted sm:w-24 text-right">= {money(value)}</div>
            <SecondaryButton icon={Save} disabled={!changed || !qty || !cost || Number(qty) <= 0 || Number(cost) <= 0} onClick={() => onSave(Number(qty), Number(cost))}>
              Save
            </SecondaryButton>
            {row.lineId && <IconButton icon={Trash2} tone="danger" title="Clear" onClick={onClear} />}
          </div>
        </div>
      ) : (
        <div className="text-sm text-ink text-right">
          {row.lineId ? (
            <>
              {row.quantity} {unitLabel(row.unit)} × {money(row.unitCost)} = <span className="font-medium">{money(row.value)}</span>
            </>
          ) : (
            <span className="text-muted">-</span>
          )}
        </div>
      )}
    </div>
  );
}

function DocSection({
  kind,
  rows,
  editable,
  date,
  onAdd,
  onEdit,
  onDelete,
}: {
  kind: 'customer' | 'supplier';
  rows: DocRow[];
  editable: boolean;
  date: string | null;
  onAdd: () => void;
  onEdit: (row: DocRow) => void;
  onDelete: (row: DocRow) => void;
}) {
  const isC = kind === 'customer';
  const total = rows.reduce((t, r) => t + Number(r.amount), 0);
  return (
    <Card>
      <SectionHelp>
        {isC
          ? `Every invoice a customer had NOT fully paid on ${date}, one line each, with the amount still unpaid. They show in Receive Payment, aging and customer statements, but not in sales or VAT reports (their VAT is already in the old returns).`
          : `Every supplier bill you had NOT fully paid on ${date}, one line each, with the amount still owed. They can be paid with Pay Bill, but are not in purchase or VAT reports.`}
      </SectionHelp>
      {editable && (
        <div className="px-4 pb-3">
          <PrimaryButton icon={Plus} onClick={onAdd}>
            {isC ? 'Add unpaid invoice' : 'Add unpaid bill'}
          </PrimaryButton>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted">{isC ? 'No unpaid invoices yet.' : 'No unpaid bills yet.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-xs text-muted border-y border-black/10 bg-black/[0.02]">
                <th className="py-2 px-4 font-medium">{isC ? 'Customer' : 'Supplier'}</th>
                <th className="py-2 px-3 font-medium">{isC ? 'Invoice no.' : 'Bill no.'}</th>
                <th className="py-2 px-3 font-medium">Date</th>
                <th className="py-2 px-3 font-medium">Due</th>
                <th className="py-2 px-3 font-medium text-right">Unpaid</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 px-4 text-ink">{r.partyName}</td>
                  <td className="py-2 px-3">{r.documentNumber}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{r.documentDate}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{r.dueDate || '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{money(r.amount)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {editable && (
                      <>
                        <IconButton icon={Pencil} title="Edit" onClick={() => onEdit(r)} />
                        <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(r)} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold border-t border-black/10">
                <td className="py-2 px-4" colSpan={4}>
                  Total
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{money(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DocModal({
  kind,
  row,
  parties,
  maxDate,
  onClose,
  onSave,
  error,
}: {
  kind: 'customer' | 'supplier';
  row?: DocRow;
  parties: Party[];
  maxDate: string;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  error: string;
}) {
  const isC = kind === 'customer';
  const [partyId, setPartyId] = useState(row?.partyId || '');
  const [number, setNumber] = useState(row?.documentNumber || '');
  const [docDate, setDocDate] = useState(row?.documentDate || '');
  const [dueDate, setDueDate] = useState(row?.dueDate || '');
  const [amount, setAmount] = useState(row ? String(row.amount) : '');
  const [note, setNote] = useState(row?.note || '');
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...parties].sort((a, b) => a.name.localeCompare(b.name)), [parties]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave({
      refId: partyId,
      documentNumber: number.trim(),
      documentDate: docDate,
      dueDate: dueDate || undefined,
      amount: Number(amount),
      note: note.trim() || undefined,
    });
    setBusy(false);
  }

  return (
    <Modal title={row ? (isC ? 'Edit unpaid invoice' : 'Edit unpaid bill') : isC ? 'Add unpaid invoice' : 'Add unpaid bill'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={isC ? 'Customer' : 'Supplier'}>
          <select className={inputClass} value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
            <option value="">Select…</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isC ? 'Old invoice number (as in the old system)' : "Supplier's bill number"}>
          <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isC ? 'Invoice date' : 'Bill date'}>
            <input type="date" className={inputClass} value={docDate} max={maxDate} onChange={(e) => setDocDate(e.target.value)} required />
          </Field>
          <Field label="Due date (optional)">
            <input type="date" className={inputClass} value={dueDate} min={docDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label={isC ? 'Amount still unpaid (OMR, incl. VAT)' : 'Amount still owed (OMR, incl. VAT)'}>
          <input type="number" min="0.001" step="0.001" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AccountModal({
  row,
  options,
  onClose,
  onSave,
  error,
}: {
  row?: AccountRow;
  options: AccountOption[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  error: string;
}) {
  const [accountId, setAccountId] = useState(row?.accountId || '');
  const [side, setSide] = useState<'debit' | 'credit'>(row && row.credit > 0 ? 'credit' : 'debit');
  const [amount, setAmount] = useState(row ? String(row.debit || row.credit) : '');
  const [note, setNote] = useState(row?.note || '');
  const [busy, setBusy] = useState(false);
  const chosen = options.find((o) => o.id === accountId);
  // usual side: assets debit, liabilities and equity credit
  useEffect(() => {
    if (!row && chosen) setSide(chosen.type === 'asset' ? 'debit' : 'credit');
  }, [chosen, row]);
  const typeLabel: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave({
      refId: accountId,
      debit: side === 'debit' ? Number(amount) : 0,
      credit: side === 'credit' ? Number(amount) : 0,
      note: note.trim() || undefined,
    });
    setBusy(false);
  }

  return (
    <Modal title={row ? 'Edit account balance' : 'Add account balance'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Account">
          <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} required disabled={!!row}>
            <option value="">Select…</option>
            {['asset', 'liability', 'equity'].map((t) => (
              <optgroup key={t} label={typeLabel[t]}>
                {options
                  .filter((o) => o.type === t)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Side">
            <select className={inputClass} value={side} onChange={(e) => setSide(e.target.value as 'debit' | 'credit')}>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </Field>
          <Field label="Amount (OMR)">
            <input type="number" min="0.001" step="0.001" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Usually: assets on the debit side; liabilities, capital and retained earnings on the credit side. Accumulated depreciation is a credit.
        </p>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function FinalizeModal({ data, onClose, onConfirm, error }: { data: Overview; onClose: () => void; onConfirm: () => Promise<void>; error: string }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = data.summary;
  return (
    <Modal title="Finalize opening balances?" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-ink">This posts one journal entry dated {data.openingBalanceDate} and creates:</p>
        <ul className="list-disc pl-5 text-ink/80 space-y-0.5">
          <li>{data.customers.length} unpaid customer invoice(s) - {money(s.customers)}</li>
          <li>{data.suppliers.length} unpaid supplier bill(s) - {money(s.suppliers)}</li>
          <li>Stock at cost - {money(s.rawMaterials + s.finishedGoods)}</li>
          <li>Bank &amp; cash balances - {money(s.bank)}</li>
          <li>
            3900 Opening Balance Equity - {money(Math.abs(s.openingBalanceEquity))} {s.openingBalanceEquity >= 0 ? 'Cr' : 'Dr'}
          </li>
        </ul>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          After this, opening balances cannot be changed and nothing can be recorded on or before {data.openingBalanceDate}. Mistakes are corrected with
          normal documents dated after it (credit note, stock adjustment, bank transaction).
        </div>
        <label className="flex items-start gap-2 text-ink/80">
          <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I have checked these figures against the old books.</span>
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            disabled={!checked || busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {busy ? 'Finalizing…' : 'Finalize'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
