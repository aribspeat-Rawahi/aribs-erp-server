import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { PAYMENT_TYPE_OPTIONS } from '../constants';
import { formatQuantityWithUnit, quantityInputStep, snapQuantityToUnit, unitLabel } from '../utils/formatQuantity';

interface Customer {
  id: string;
  name: string;
}
interface FinishedGood {
  id: string;
  name: string;
  unit: string;
  sellingPrice: number;
  vatRate: number;
}
interface SalesOrder {
  id: string;
  customerId: string;
  status: string;
  items: { finishedGoodId: string; quantity: number; unit?: string; unitPrice: number }[];
}

const statusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
};

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

export default function SalesOrders() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin', 'accountant']);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    api.get('/sales-orders').then((res) => setOrders(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  // "Cement x 10 Bags, Sand x 2.500 Tons" - the line's own unit, else the product's.
  function itemsSummary(o: SalesOrder) {
    return (o.items || [])
      .map((it) => {
        const fg = finishedGoods.find((f) => f.id === it.finishedGoodId);
        return `${fg?.name || 'Item'} x ${formatQuantityWithUnit(it.quantity, it.unit || fg?.unit)}`;
      })
      .join(', ');
  }

  async function remove(o: SalesOrder) {
    const note =
      o.status === 'completed'
        ? '\n\nIf this order took stock out (older orders did), the stock is put back.'
        : '\n\nAdmin, CEO, MD and Accountant are emailed and can undo it from the Activity Log.';
    if (!window.confirm(`Delete this sales order?${note}`)) return;
    try {
      await api.delete(`/sales-orders/${o.id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this sales order.');
    }
  }

  async function act(id: string, action: 'complete' | 'cancel') {
    try {
      await api.post(`/sales-orders/${id}/${action}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not ${action} this order.`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        subtitle="Order tracking — stock leaves when the invoice is created"
        action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNew(true)}>New sales order</PrimaryButton>}
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState>No sales orders yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {orders.map((o) => (
              <div key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{customerName(o.customerId)}</div>
                  <div className="text-xs text-muted">{o.items?.length || 0} item(s)</div>
                  {!!o.items?.length && <div className="text-xs text-muted break-words">{itemsSummary(o)}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
                    {o.status}
                  </span>
                  {o.status === 'pending' && (
                    <>
                      <SecondaryButton requires="edit" onClick={() => act(o.id, 'complete')}>Complete</SecondaryButton>
                      <SecondaryButton requires="edit" onClick={() => act(o.id, 'cancel')}>Cancel</SecondaryButton>
                    </>
                  )}
                  {canDelete && <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => remove(o)} />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showNew && (
        <NewSalesOrderModal
          customers={customers}
          finishedGoods={finishedGoods}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewSalesOrderModal({
  customers,
  finishedGoods,
  onClose,
  onSaved,
}: {
  customers: Customer[];
  finishedGoods: FinishedGood[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [paymentType, setPaymentType] = useState('');
  const [items, setItems] = useState([{ _key: newItemKey(), finishedGoodId: finishedGoods[0]?.id || '', quantity: '1', unitPrice: String(finishedGoods[0]?.sellingPrice ?? 0) }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateItem(i: number, patch: Partial<{ finishedGoodId: string; quantity: string; unitPrice: string }>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/sales-orders', {
        customerId,
        paymentType: paymentType || undefined,
        items: items.map((it) => ({
          finishedGoodId: it.finishedGoodId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create the order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New sales order" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment terms (optional)">
            <select className={inputClass} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              <option value="">-</option>
              {PAYMENT_TYPE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="space-y-2">
          {items.map((item, i) => {
            // A sales order line is always a product, so the unit is the product's.
            const unit = finishedGoods.find((f) => f.id === item.finishedGoodId)?.unit;
            return (
              <div key={item._key} className="grid grid-cols-[1fr_64px_1fr] gap-2 border-b border-black/5 pb-2 sm:grid-cols-[1fr_90px_64px_110px] sm:border-0 sm:pb-0">
                <select
                  className={`${inputClass} col-span-3 sm:col-span-1`}
                  value={item.finishedGoodId}
                  onChange={(e) => {
                    const fg = finishedGoods.find((f) => f.id === e.target.value);
                    updateItem(i, {
                      finishedGoodId: e.target.value,
                      quantity: String(snapQuantityToUnit(Number(item.quantity) || 0, fg?.unit) || 1),
                      unitPrice: String(fg?.sellingPrice ?? 0),
                    });
                  }}
                >
                  {finishedGoods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  type="number"
                  step={quantityInputStep(unit)}
                  min={quantityInputStep(unit)}
                  placeholder="Qty"
                  title="Quantity"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  onBlur={(e) =>
                    updateItem(i, {
                      quantity: String(snapQuantityToUnit(Number(e.target.value) || 0, unit)),
                    })
                  }
                  required
                />
                <div className="h-full flex items-center justify-center rounded-lg bg-black/5 px-2 text-sm text-ink/70" title="Unit comes from the product">
                  {unitLabel(unit)}
                </div>
                <input className={inputClass} type="number" step="0.001" min="0" placeholder="Unit price" title="Unit price (OMR)" value={item.unitPrice} onChange={(e) => updateItem(i, { unitPrice: e.target.value })} />
              </div>
            );
          })}
          <SecondaryButton
            onClick={() => setItems((prev) => [...prev, { _key: newItemKey(), finishedGoodId: finishedGoods[0]?.id || '', quantity: '1', unitPrice: String(finishedGoods[0]?.sellingPrice ?? 0) }])}
          >
            + Add item
          </SecondaryButton>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
