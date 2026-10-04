import { FormEvent, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Play, Pause, Zap, Eye } from 'lucide-react';
import api from '../api/client';
import { viewPdf } from '../api/docActions';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS, TEMPLATE_OPTIONS, labelFor } from '../constants';
import { UNIT_OPTIONS, normalizeUnit, quantityInputStep, quantityInputValue, snapQuantityToUnit, unitLabel } from '../utils/formatQuantity';

interface Customer {
  id: string;
  name: string;
}
interface FinishedGood {
  id: string;
  name: string;
  unit: string;
  sellingPrice: number;
}
interface RecurringItem {
  finishedGoodId?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
}
interface RecurringInvoice {
  id: string;
  customerId: string;
  label: string;
  items: RecurringItem[];
  discountAmount?: number;
  paymentType?: string;
  deliveryMethod?: string;
  template?: string;
  vatExcluded?: boolean;
  dueDays?: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  nextRunDate: string;
  endDate?: string;
  active: boolean;
  lastGeneratedInvoiceId?: string;
  lastRunAt?: string;
}

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function RecurringInvoices() {
  const [items, setItems] = useState<RecurringInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<RecurringInvoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/recurring-invoices').then((res) => setItems(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  async function toggleActive(item: RecurringInvoice) {
    setBusyId(item.id);
    try {
      await api.patch(`/recurring-invoices/${item.id}`, { active: !item.active });
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not update this recurring invoice.');
    } finally {
      setBusyId(null);
    }
  }

  async function generateNow(item: RecurringInvoice) {
    if (!window.confirm(`Generate an invoice for "${item.label}" right now?`)) return;
    setBusyId(item.id);
    try {
      const res = await api.post(`/recurring-invoices/${item.id}/generate-now`);
      if (res.data?.pendingApproval) {
        window.alert(res.data.message || 'Sent for approval instead of generating immediately.');
      }
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not generate the invoice.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this recurring invoice template? Already-generated invoices are not affected.')) return;
    try {
      await api.delete(`/recurring-invoices/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this recurring invoice.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Recurring Invoices"
        subtitle="Rent, subscriptions and retainers that bill automatically on a schedule"
        action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNew(true)}>New recurring invoice</PrimaryButton>}
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState>No recurring invoices set up yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink flex flex-wrap items-center gap-2">
                    {item.label}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'}`}>
                      {item.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {customerName(item.customerId)} · {labelFor(FREQUENCY_OPTIONS, item.frequency)} · Next: {item.active ? item.nextRunDate : '-'}
                    {item.lastRunAt ? ` · Last run: ${item.lastRunAt}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.lastGeneratedInvoiceId && (
                    <IconButton icon={Eye} title="View last generated invoice" onClick={() => viewPdf(`/invoices/${item.lastGeneratedInvoiceId}/pdf`)} />
                  )}
                  <IconButton
                    icon={Zap}
                    title="Generate now"
                    requires="edit"
                    onClick={() => busyId !== item.id && generateNow(item)}
                  />
                  <IconButton
                    icon={item.active ? Pause : Play}
                    title={item.active ? 'Pause' : 'Resume'}
                    requires="edit"
                    onClick={() => busyId !== item.id && toggleActive(item)}
                  />
                  <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditing(item)} />
                  <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => remove(item.id)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showNew && (
        <RecurringInvoiceModal
          customers={customers}
          finishedGoods={finishedGoods}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
      {editing && (
        <RecurringInvoiceModal
          existing={editing}
          customers={customers}
          finishedGoods={finishedGoods}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// A line in the form. A product line always uses the product's unit; a
// custom line picks one from the fixed list.
interface FormItem {
  _key: string;
  finishedGoodId?: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

function blankItem(finishedGoods: FinishedGood[]): FormItem {
  const fg = finishedGoods[0];
  return {
    _key: newItemKey(),
    finishedGoodId: fg?.id || '',
    description: fg?.name || '',
    quantity: '1',
    unit: normalizeUnit(fg?.unit),
    unitPrice: String(fg?.sellingPrice ?? 0),
  };
}

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

function RecurringInvoiceModal({
  existing,
  customers,
  finishedGoods,
  onClose,
  onSaved,
}: {
  existing?: RecurringInvoice;
  customers: Customer[];
  finishedGoods: FinishedGood[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const [customerId, setCustomerId] = useState(existing?.customerId || customers[0]?.id || '');
  const [label, setLabel] = useState(existing?.label || '');
  const [items, setItems] = useState<FormItem[]>(
    existing?.items?.length
      ? existing.items.map((it) => {
          const product = finishedGoods.find((f) => f.id === it.finishedGoodId);
          const unit = normalizeUnit(product?.unit || it.unit);
          return {
            _key: newItemKey(),
            finishedGoodId: it.finishedGoodId || '',
            description: it.description,
            quantity: quantityInputValue(it.quantity, unit),
            unit,
            unitPrice: String(it.unitPrice),
          };
        })
      : [blankItem(finishedGoods)],
  );
  const [discountAmount, setDiscountAmount] = useState(existing?.discountAmount ? String(existing.discountAmount) : '0');
  const [paymentType, setPaymentType] = useState(existing?.paymentType || '');
  const [deliveryMethod, setDeliveryMethod] = useState(existing?.deliveryMethod || '');
  const [template, setTemplate] = useState(existing?.template || 'classic');
  const [dueDays, setDueDays] = useState(existing?.dueDays != null ? String(existing.dueDays) : '');
  const [frequency, setFrequency] = useState(existing?.frequency || 'monthly');
  const [startDate, setStartDate] = useState(existing?.startDate || todayStr());
  const [endDate, setEndDate] = useState(existing?.endDate || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateItem(i: number, patch: Partial<FormItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, blankItem(finishedGoods)]);
  }
  function removeItem(i: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      customerId,
      label,
      items: items.map((it) => ({
        finishedGoodId: it.finishedGoodId || undefined,
        description: it.description,
        quantity: Number(it.quantity),
        unit: it.unit,
        unitPrice: Number(it.unitPrice),
      })),
      discountAmount: Number(discountAmount) || 0,
      paymentType: paymentType || undefined,
      deliveryMethod: deliveryMethod || undefined,
      template,
      dueDays: dueDays !== '' ? Number(dueDays) : undefined,
      frequency,
      startDate,
      endDate: endDate || undefined,
    };
    try {
      if (isEdit && existing) {
        await api.patch(`/recurring-invoices/${existing.id}`, body);
      } else {
        await api.post('/recurring-invoices', body);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${isEdit ? 'Edit' : 'New'} recurring invoice`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Label">
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Warehouse rent" required />
          </Field>
          <Field label="Customer">
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted">Items</span>
          {items.map((item, i) => {
            const isProductLine = !!item.finishedGoodId;
            return (
              <div
                key={item._key}
                className="grid grid-cols-[1fr_72px_1fr_24px] gap-2 items-center border-b border-black/5 pb-2 sm:grid-cols-[1fr_80px_76px_100px_24px] sm:border-0 sm:pb-0"
              >
                <select
                  className={`${inputClass} col-span-4 sm:col-span-1`}
                  value={item.finishedGoodId}
                  onChange={(e) => {
                    const fg = finishedGoods.find((f) => f.id === e.target.value);
                    const unit = fg ? normalizeUnit(fg.unit) : item.unit;
                    updateItem(i, {
                      finishedGoodId: e.target.value,
                      description: fg?.name || item.description,
                      unit,
                      quantity: String(snapQuantityToUnit(Number(item.quantity) || 0, unit) || 1),
                      unitPrice: fg ? String(fg.sellingPrice) : item.unitPrice,
                    });
                  }}
                >
                  <option value="">Custom item</option>
                  {finishedGoods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  type="number"
                  step={quantityInputStep(item.unit)}
                  min={quantityInputStep(item.unit)}
                  placeholder="Qty"
                  title="Quantity"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  onBlur={(e) =>
                    updateItem(i, {
                      quantity: String(snapQuantityToUnit(Number(e.target.value) || 0, item.unit)),
                    })
                  }
                  required
                />
                {isProductLine ? (
                  <div className="h-full flex items-center justify-center rounded-lg bg-black/5 px-2 text-sm text-ink/70" title="Unit comes from the product">
                    {unitLabel(item.unit)}
                  </div>
                ) : (
                  <select
                    className={inputClass}
                    value={item.unit}
                    title="Unit"
                    onChange={(e) =>
                      updateItem(i, {
                        unit: e.target.value,
                        quantity: String(snapQuantityToUnit(Number(item.quantity) || 0, e.target.value) || 1),
                      })
                    }
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  className={inputClass}
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Unit price"
                  title="Unit price (OMR)"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                />
                <button type="button" onClick={() => removeItem(i)} className="text-muted hover:text-red-600 text-lg leading-none" title="Remove item">
                  &times;
                </button>
              </div>
            );
          })}
          <SecondaryButton onClick={addItem}>+ Add item</SecondaryButton>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Frequency">
            <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as any)}>
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isEdit ? 'Next run date' : 'Start date'}>
            <input
              className={inputClass}
              type="date"
              value={isEdit ? existing?.nextRunDate : startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isEdit}
            />
          </Field>
          <Field label="End date (optional)">
            <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Discount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
          </Field>
          <Field label="Due days after issue (optional)">
            <input className={inputClass} type="number" min="0" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </Field>
          <Field label="PDF template">
            <select className={inputClass} value={template} onChange={(e) => setTemplate(e.target.value)}>
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment terms">
            <select className={inputClass} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              <option value="">-</option>
              {PAYMENT_TYPE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Delivery method">
            <select className={inputClass} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
              <option value="">-</option>
              {DELIVERY_METHOD_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {isEdit && (
          <p className="text-xs text-muted">
            To change the next run date itself, pause and resume, or adjust it isn't exposed here — delete and recreate if the schedule needs to shift.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
