import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, ArrowRightLeft, Banknote } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { localISODate } from '../utils/dates';

interface Supplier {
  id: string;
  name: string;
}
interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}
interface VendorCreditApplication {
  id: string;
  amount: number | string;
  date: string;
  note?: string;
}
interface VendorCreditRefund {
  id: string;
  amount: number | string;
  date: string;
}
interface VendorCredit {
  id: string;
  creditNumber: string;
  supplierId: string;
  amount: number | string;
  date: string;
  reason?: string;
  appliedAmount: number | string;
  refundedAmount: number | string;
  applications: VendorCreditApplication[];
  refunds: VendorCreditRefund[];
}

function money(n: number | string) {
  return Number(n).toFixed(3);
}

// "Vendor Credits" tab on the Suppliers page — a credit note from a
// supplier not tied to a specific PurchaseReturn (goodwill credit, price
// adjustment, rebate…). It reduces Accounts Payable in full as soon as
// it's issued; Apply is a tracking-only record of which bill it offset,
// and Refund records the supplier paying actual cash back instead (see
// VendorCreditService on the backend for the full accounting).
export default function VendorCreditsPanel({
  suppliers,
  bankAccounts,
}: {
  suppliers: Supplier[];
  bankAccounts: BankAccount[];
}) {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [items, setItems] = useState<VendorCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [applying, setApplying] = useState<VendorCredit | null>(null);
  const [refunding, setRefunding] = useState<VendorCredit | null>(null);

  function load() {
    setLoading(true);
    api.get('/vendor-credits').then((res) => setItems(res.data)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function supplierName(id: string) {
    return suppliers.find((s) => s.id === id)?.name || id;
  }

  async function removeItem(id: string) {
    if (!window.confirm('Delete this vendor credit? Only possible before any of it has been applied or refunded. This cannot be undone.')) return;
    try {
      await api.delete(`/vendor-credits/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this credit.');
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        {canManage && <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>New vendor credit</PrimaryButton>}
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState>No vendor credits yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {items.map((c) => {
              const remaining = Number(c.amount) - Number(c.appliedAmount) - Number(c.refundedAmount);
              return (
                <div key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{supplierName(c.supplierId)}</div>
                    <div className="text-xs text-muted">
                      <span className="whitespace-nowrap">{c.creditNumber}</span> · {c.date}
                      {c.reason ? ` · ${c.reason}` : ''}
                    </div>
                    {(c.applications.length > 0 || c.refunds.length > 0) && (
                      <div className="text-xs text-muted mt-0.5">
                        {c.applications.length > 0 && `Applied: ${c.applications.map((a) => `${money(a.amount)} OMR`).join(', ')}`}
                        {c.applications.length > 0 && c.refunds.length > 0 ? ' · ' : ''}
                        {c.refunds.length > 0 && `Refunded: ${c.refunds.map((r) => `${money(r.amount)} OMR`).join(', ')}`}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                    <div className="sm:text-right">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{money(c.amount)} OMR</div>
                      <div className="text-xs text-muted">{remaining > 0.001 ? `${money(remaining)} remaining` : 'Fully used'}</div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1.5">
                        {remaining > 0.001 && (
                          <>
                            <IconButton icon={ArrowRightLeft} title="Apply against a bill" requires="edit" onClick={() => setApplying(c)} />
                            <IconButton icon={Banknote} title="Record cash refund" requires="edit" onClick={() => setRefunding(c)} />
                          </>
                        )}
                        {Number(c.appliedAmount) === 0 && Number(c.refundedAmount) === 0 && (
                          <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => removeItem(c.id)} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showAdd && (
        <NewCreditModal
          suppliers={suppliers}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {applying && (
        <ApplyCreditModal
          item={applying}
          onClose={() => setApplying(null)}
          onSaved={() => {
            setApplying(null);
            load();
          }}
        />
      )}
      {refunding && (
        <RefundCreditModal
          item={refunding}
          bankAccounts={bankAccounts}
          onClose={() => setRefunding(null)}
          onSaved={() => {
            setRefunding(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewCreditModal({
  suppliers,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [amount, setAmount] = useState('0');
  const [date, setDate] = useState(localISODate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/vendor-credits', {
        supplierId,
        amount: Number(amount),
        date,
        reason: reason || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this credit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New vendor credit" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Supplier">
          <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Reason (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill credit, price adjustment, rebate…" />
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

function ApplyCreditModal({
  item,
  onClose,
  onSaved,
}: {
  item: VendorCredit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const remaining = Number(item.amount) - Number(item.appliedAmount) - Number(item.refundedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(localISODate());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // the supplier's purchase orders that still owe money (received value - paid)
  const [orders, setOrders] = useState<{ id: string; poNumber?: string; due: number }[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  useEffect(() => {
    api.get('/purchase-orders').then((res) => {
      const list = (res.data as any[])
        .filter((o) => o.supplierId === item.supplierId && (o.status === 'received' || o.status === 'partially_received'))
        .map((o) => ({ id: o.id, poNumber: o.openingReference ? `${o.poNumber} (bill ${o.openingReference})` : o.poNumber, due: Math.round((Number(o.receivedTotal || 0) - Number(o.paidAmount || 0)) * 1000) / 1000 }))
        .filter((o) => o.due > 0.0005);
      setOrders(list);
      if (list.length) setPurchaseOrderId(list[0].id);
    });
  }, [item.supplierId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/vendor-credits/${item.id}/apply`, {
        amount: Number(amount),
        date,
        note: note || undefined,
        purchaseOrderId,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not apply this credit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Apply credit — ${item.creditNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          {money(remaining)} OMR remaining · applying it lowers what is still owed on the chosen bill (Accounts Payable was already reduced when this credit was issued).
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount to apply (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Apply to purchase order (bill)">
          <select className={inputClass} value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)} required>
            {orders.length === 0 && <option value="">No unpaid bills for this supplier</option>}
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.poNumber || o.id.slice(0, 8)} — {money(o.due)} OMR due
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy || !purchaseOrderId}>{busy ? 'Applying…' : 'Apply'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RefundCreditModal({
  item,
  bankAccounts,
  onClose,
  onSaved,
}: {
  item: VendorCredit;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const remaining = Number(item.amount) - Number(item.appliedAmount) - Number(item.refundedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(localISODate());
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/vendor-credits/${item.id}/refund`, {
        amount: Number(amount),
        date,
        bankAccountId,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not record this refund.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Record refund — ${item.creditNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          {money(remaining)} OMR remaining — the supplier is paying this back in cash instead of it being used against a future bill.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Refund amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Deposit into">
          <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({money(b.currentBalance)} OMR)</option>
            ))}
          </select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Confirm refund'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
