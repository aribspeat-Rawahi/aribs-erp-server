import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, ArrowRightLeft } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';

interface Supplier {
  id: string;
  name: string;
}
interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}
interface VendorPrepaymentApplication {
  id: string;
  amount: number | string;
  date: string;
  note?: string;
}
interface VendorPrepayment {
  id: string;
  prepaymentNumber: string;
  supplierId: string;
  amount: number | string;
  date: string;
  bankAccountId: string;
  appliedAmount: number | string;
  note?: string;
  applications: VendorPrepaymentApplication[];
}

function money(n: number | string) {
  return Number(n).toFixed(3);
}

// "Vendor Prepayments" tab on the Suppliers page — advances paid to a
// supplier ahead of a bill. Applying a prepayment against Accounts
// Payable is tracked one application at a time (see VendorPrepaymentService
// on the backend), so a single prepayment can be used across several bills.
export default function VendorPrepaymentsPanel({
  suppliers,
  bankAccounts,
}: {
  suppliers: Supplier[];
  bankAccounts: BankAccount[];
}) {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [items, setItems] = useState<VendorPrepayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [applying, setApplying] = useState<VendorPrepayment | null>(null);

  function load() {
    setLoading(true);
    api.get('/vendor-prepayments').then((res) => setItems(res.data)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function supplierName(id: string) {
    return suppliers.find((s) => s.id === id)?.name || id;
  }
  function bankAccountName(id: string) {
    return bankAccounts.find((b) => b.id === id)?.name || id;
  }

  async function removeItem(id: string) {
    if (!window.confirm('Delete this prepayment? Only possible before any of it has been applied. This cannot be undone.')) return;
    try {
      await api.delete(`/vendor-prepayments/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this prepayment.');
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        {canManage && <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>New prepayment</PrimaryButton>}
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState>No vendor prepayments yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {items.map((p) => {
              const remaining = Number(p.amount) - Number(p.appliedAmount);
              return (
                <div key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{supplierName(p.supplierId)}</div>
                    <div className="text-xs text-muted">
                      <span className="whitespace-nowrap">{p.prepaymentNumber}</span> · {p.date} · Paid from {bankAccountName(p.bankAccountId)}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                    {p.applications.length > 0 && (
                      <div className="text-xs text-muted mt-0.5">
                        Applied: {p.applications.map((a) => `${money(a.amount)} OMR (${a.date})`).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                    <div className="sm:text-right">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{money(p.amount)} OMR</div>
                      <div className="text-xs text-muted">{remaining > 0.001 ? `${money(remaining)} remaining` : 'Fully applied'}</div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1.5">
                        {remaining > 0.001 && (
                          <IconButton icon={ArrowRightLeft} title="Apply against payable" requires="edit" onClick={() => setApplying(p)} />
                        )}
                        {Number(p.appliedAmount) === 0 && (
                          <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => removeItem(p.id)} />
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
        <NewPrepaymentModal
          suppliers={suppliers}
          bankAccounts={bankAccounts}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {applying && (
        <ApplyPrepaymentModal
          item={applying}
          onClose={() => setApplying(null)}
          onSaved={() => {
            setApplying(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewPrepaymentModal({
  suppliers,
  bankAccounts,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [amount, setAmount] = useState('0');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/vendor-prepayments', {
        supplierId,
        amount: Number(amount),
        date,
        bankAccountId,
        note: note || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this prepayment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New vendor prepayment" onClose={onClose}>
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
        <Field label="Paid from account">
          <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({money(b.currentBalance)} OMR)</option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
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

function ApplyPrepaymentModal({
  item,
  onClose,
  onSaved,
}: {
  item: VendorPrepayment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const remaining = Number(item.amount) - Number(item.appliedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
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
        .map((o) => ({ id: o.id, poNumber: o.poNumber, due: Math.round((Number(o.receivedTotal || 0) - Number(o.paidAmount || 0)) * 1000) / 1000 }))
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
      await api.post(`/vendor-prepayments/${item.id}/apply`, {
        amount: Number(amount),
        date,
        note: note || undefined,
        purchaseOrderId,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not apply this prepayment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Apply prepayment — ${item.prepaymentNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          {money(remaining)} OMR remaining unapplied
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
