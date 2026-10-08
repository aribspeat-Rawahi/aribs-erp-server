import { FormEvent, useEffect, useState } from 'react';
import api from '../api/client';
import { PrimaryButton, SecondaryButton, Modal, Field, inputClass } from './ui';
import { PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS, TEMPLATE_OPTIONS } from '../constants';
import { UNIT_OPTIONS, formatQuantityWithUnit, normalizeUnit, quantityInputStep, quantityInputValue, snapQuantityToUnit, unitLabel } from '../utils/formatQuantity';
import { localISODate } from '../utils/dates';

export type DocType = 'quotation' | 'invoice' | 'delivery_note';

interface Customer {
  id: string;
  name: string;
  // false = not VAT registered/applicable: new documents default to VAT excluded
  vatApplicable?: boolean;
}
interface FinishedGood {
  id: string;
  name: string;
  unit: string;
  sellingPrice: number;
  quantityInStock?: number | string;
}

interface DocItem {
  _key: string;
  finishedGoodId?: string;
  description: string;
  quantity: string;
  // A product line always uses the product's unit (set in the product
  // form); only a "Custom item" line lets the user pick one.
  unit: string;
  unitPrice: string;
}

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

export interface ExistingDoc {
  id: string;
  customerId?: string;
  items?: {
    finishedGoodId?: string;
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
  }[];
  paymentType?: string;
  deliveryMethod?: string;
  discountAmount?: number;
  dueDate?: string;
  deliveryDate?: string;
  validUntil?: string;
  vatExcluded?: boolean;
  template?: string;
}

const ENDPOINTS: Record<DocType, string> = {
  quotation: '/quotations',
  invoice: '/invoices',
  delivery_note: '/delivery-notes',
};

const TITLES: Record<DocType, string> = {
  quotation: 'quotation',
  invoice: 'invoice',
  delivery_note: 'delivery note',
};

function blankItem(finishedGoods: FinishedGood[]): DocItem {
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

export default function NewDocumentModal({
  docType,
  customers,
  finishedGoods,
  existing,
  onClose,
  onSaved,
}: {
  docType: DocType;
  customers: Customer[];
  finishedGoods: FinishedGood[];
  existing?: ExistingDoc;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const [customerId, setCustomerId] = useState(existing?.customerId || customers[0]?.id || '');
  const [items, setItems] = useState<DocItem[]>(
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
  const [paymentType, setPaymentType] = useState(existing?.paymentType || '');
  const [deliveryMethod, setDeliveryMethod] = useState(existing?.deliveryMethod || '');
  const [discountAmount, setDiscountAmount] = useState(existing?.discountAmount ? String(existing.discountAmount) : '0');
  const [dueDate, setDueDate] = useState(existing?.dueDate || '');
  const [deliveryDate, setDeliveryDate] = useState(existing?.deliveryDate || '');
  const [validUntil, setValidUntil] = useState(existing?.validUntil || '');
  // New documents follow the customer's "VAT applicable" setting until the
  // user ticks/unticks the box themselves; an edit keeps the saved value.
  const customerVatExcluded = (id: string) => customers.find((c) => c.id === id)?.vatApplicable === false;
  const [vatExcluded, setVatExcluded] = useState(existing ? !!existing.vatExcluded : customerVatExcluded(customerId));
  const [vatTouched, setVatTouched] = useState(isEdit);
  useEffect(() => {
    if (!vatTouched) setVatExcluded(customerVatExcluded(customerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, vatTouched]);
  const [template, setTemplate] = useState(existing?.template || 'classic');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Invoice stock check: stock leaves when the invoice is saved and may go
  // below zero. Live stock is fetched when the form opens; when editing,
  // this invoice's own quantities are already out of stock, so only the
  // extra counts.
  const [liveStock, setLiveStock] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (docType !== 'invoice') return;
    api
      .get('/finished-goods')
      .then((res) => setLiveStock(Object.fromEntries((res.data as FinishedGood[]).map((f) => [f.id, Number(f.quantityInStock) || 0]))))
      .catch(() => setLiveStock(Object.fromEntries(finishedGoods.map((f) => [f.id, Number(f.quantityInStock) || 0]))));
  }, [docType]);
  const shortages =
    docType === 'invoice' && liveStock
      ? (() => {
          const wanted = new Map<string, number>();
          for (const it of items) if (it.finishedGoodId) wanted.set(it.finishedGoodId, (wanted.get(it.finishedGoodId) || 0) + (Number(it.quantity) || 0));
          const already = new Map<string, number>();
          for (const it of existing?.items || []) if (it.finishedGoodId) already.set(it.finishedGoodId, (already.get(it.finishedGoodId) || 0) + Number(it.quantity));
          const out: { name: string; unit: string; need: number; inStock: number; short: number }[] = [];
          for (const [id, need] of wanted) {
            const inStock = Math.max(0, liveStock[id] ?? 0);
            const extra = need - (already.get(id) || 0);
            const short = Math.round((extra - inStock) * 1000) / 1000;
            if (extra > 0 && short > 0) {
              const fg = finishedGoods.find((f) => f.id === id);
              out.push({ name: fg?.name || 'Item', unit: normalizeUnit(fg?.unit), need: extra, inStock, short });
            }
          }
          return out;
        })()
      : [];
  const stockShort = shortages.length > 0;
  // Goods that aren't in stock can't be handed over at the counter: switch
  // to "Delivery on Site" so the sales person sets the delivery date.
  useEffect(() => {
    if (stockShort && deliveryMethod !== 'on_site') setDeliveryMethod('on_site');
  }, [stockShort]);

  // Delivery date only makes sense for an on-site delivery — clear and
  // lock the field whenever the delivery method isn't "on site".
  const deliveryDateEnabled = deliveryMethod === 'on_site';
  useEffect(() => {
    if (!deliveryDateEnabled && deliveryDate) setDeliveryDate('');
  }, [deliveryDateEnabled]);

  function updateItem(i: number, patch: Partial<DocItem>) {
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
    if (stockShort) {
      if (!deliveryDate) {
        setError('Stock is short - choose the delivery date before saving.');
        return;
      }
      const list = shortages.map((s) => `- ${s.name}: ${formatQuantityWithUnit(s.short, s.unit)} short`).join('\n');
      if (!window.confirm(`Not enough stock:\n${list}\n\nThe invoice will be marked "Waiting for stock" until the stock comes in. Save anyway?`)) return;
    }
    setBusy(true);
    setError('');
    setNotice('');

    const payloadItems = items.map((it) => ({
      finishedGoodId: it.finishedGoodId || undefined,
      description: it.description,
      quantity: Number(it.quantity),
      unit: it.unit,
      unitPrice: Number(it.unitPrice),
    }));

    const body: Record<string, unknown> = {
      items: payloadItems,
      discountAmount: Number(discountAmount) || 0,
      deliveryMethod: deliveryMethod || undefined,
    };
    // Quotation and invoice forms carry the same fields (a quotation has
    // "Valid until" where an invoice has "Due date").
    body.paymentType = paymentType || undefined;
    body.deliveryDate = deliveryDate || undefined;
    if (docType === 'quotation') {
      body.validUntil = validUntil || undefined;
    }
    if (docType === 'invoice') {
      body.dueDate = dueDate || undefined;
    }
    if (docType === 'invoice' || docType === 'quotation') {
      body.vatExcluded = vatExcluded;
      body.template = template;
    }
    body.customerId = customerId;

    try {
      const pending = await submit(body);
      if (!pending) onSaved();
    } catch (err: any) {
      if ((docType === 'invoice' || docType === 'quotation') && err?.response?.data?.approvalRequired) {
        const d = err.response.data;
        const proceed = window.confirm(`${d.message}\n\nSend this for approval instead?`);
        if (proceed) {
          try {
            const pending = await submit({ ...body, requestApproval: true });
            if (!pending) onSaved();
          } catch (err2: any) {
            setError(err2?.response?.data?.message || 'Could not save.');
          }
        }
      } else {
        setError(err?.response?.data?.message || 'Could not save.');
      }
    } finally {
      setBusy(false);
    }
  }

  // Returns true when the submission was queued for approval instead of
  // taking effect immediately (a different-day quotation price edit, or
  // one of the CRM Step 7 gates on invoice/quotation create) — the modal
  // then shows the notice and stays open rather than closing as if the
  // document were created/saved.
  async function submit(body: Record<string, unknown>): Promise<boolean> {
    if (isEdit && existing) {
      const res = await api.patch(`${ENDPOINTS[docType]}/${existing.id}`, body);
      if (docType === 'quotation' && res.data?.applied === false) {
        setNotice('This is a different-day change to a priced quotation, so it has been sent for approval instead of applied immediately.');
        return true;
      }
      if (res.data?.pendingApproval) {
        setNotice(res.data.message || 'Sent for approval — changes will apply once approved.');
        return true;
      }
    } else {
      const res = await api.post(ENDPOINTS[docType], body);
      if (res.data?.pendingApproval) {
        setNotice(res.data.message || 'Sent for approval — it will be created once approved.');
        return true;
      }
    }
    return false;
  }

  return (
    <Modal title={`${isEdit ? 'Edit' : 'New'} ${TITLES[docType]}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Customer">
          <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customerId && !customers.some((c) => c.id === customerId) && <option value={customerId}>(current customer)</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {(docType === 'invoice' || docType === 'quotation') && customers.find((c) => c.id === customerId)?.vatApplicable === false && (
            <span className="mt-1 block text-xs text-muted">This customer is set as not VAT applicable - VAT is excluded.</span>
          )}
        </Field>

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

        {stockShort && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="font-semibold">Not enough stock</div>
            <ul className="mt-1 space-y-0.5">
              {shortages.map((s) => (
                <li key={s.name}>
                  {s.name}: need {formatQuantityWithUnit(s.need, s.unit)}, in stock {formatQuantityWithUnit(s.inStock, s.unit)} -{' '}
                  <span className="font-semibold">{formatQuantityWithUnit(s.short, s.unit)} short</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs">
              The invoice will be marked "Waiting for stock". Choose the delivery date below - you'll get a reminder when the stock arrives.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {
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
          }
          <Field label="Delivery method">
            <select className={inputClass} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
              {!stockShort && <option value="">-</option>}
              {DELIVERY_METHOD_OPTIONS.filter((d) => !stockShort || d.value === 'on_site').map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
          </Field>
          {docType === 'quotation' && (
            <Field label="Valid until">
              <input className={inputClass} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          )}
          {docType === 'invoice' && (
            <Field label="Due date">
              <input className={inputClass} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          {
            <Field label={stockShort ? 'Delivery date (required)' : 'Delivery date'}>
              <input
                className={`${inputClass} ${!deliveryDateEnabled ? 'bg-black/5 text-muted cursor-not-allowed' : ''} ${stockShort && !deliveryDate ? 'border-red-400' : ''}`}
                type="date"
                value={deliveryDate}
                min={stockShort ? localISODate() : undefined}
                required={stockShort}
                disabled={!deliveryDateEnabled}
                title={!deliveryDateEnabled ? 'Only settable when delivery method is "Delivery on Site"' : undefined}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>
          }
        </div>

        {(docType === 'invoice' || docType === 'quotation') && (
          <div className="grid grid-cols-2 gap-3 items-center">
            <Field label="PDF template">
              <select className={inputClass} value={template} onChange={(e) => setTemplate(e.target.value)}>
                {TEMPLATE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink/80 mt-5">
              <input
                type="checkbox"
                checked={vatExcluded}
                onChange={(e) => {
                  setVatTouched(true);
                  setVatExcluded(e.target.checked);
                }}
              />
              VAT excluded for this {docType === 'quotation' ? 'quotation' : 'invoice'}
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-amber-600">{notice}</p>}
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
