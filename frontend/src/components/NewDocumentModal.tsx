import { FormEvent, useEffect, useState } from 'react';
import api from '../api/client';
import { PrimaryButton, SecondaryButton, Modal, Field, inputClass } from './ui';
import { PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS, TEMPLATE_OPTIONS } from '../constants';
import { quantityInputStep, snapQuantityToUnit } from '../utils/formatQuantity';

export type DocType = 'quotation' | 'invoice' | 'delivery_note';

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

interface DocItem {
  _key: string;
  finishedGoodId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

export interface ExistingDoc {
  id: string;
  customerId?: string;
  items?: { finishedGoodId?: string; description: string; quantity: number; unitPrice: number }[];
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
      ? existing.items.map((it) => ({
          _key: newItemKey(),
          finishedGoodId: it.finishedGoodId || '',
          description: it.description,
          quantity: String(it.quantity),
          unitPrice: String(it.unitPrice),
        }))
      : [blankItem(finishedGoods)]
  );
  const [paymentType, setPaymentType] = useState(existing?.paymentType || '');
  const [deliveryMethod, setDeliveryMethod] = useState(existing?.deliveryMethod || '');
  const [discountAmount, setDiscountAmount] = useState(existing?.discountAmount ? String(existing.discountAmount) : '0');
  const [dueDate, setDueDate] = useState(existing?.dueDate || '');
  const [deliveryDate, setDeliveryDate] = useState(existing?.deliveryDate || '');
  const [validUntil, setValidUntil] = useState(existing?.validUntil || '');
  const [vatExcluded, setVatExcluded] = useState(existing?.vatExcluded || false);
  const [template, setTemplate] = useState(existing?.template || 'classic');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setError('');
    setNotice('');

    const payloadItems = items.map((it) => ({
      finishedGoodId: it.finishedGoodId || undefined,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
    }));

    const body: Record<string, unknown> = {
      items: payloadItems,
      discountAmount: Number(discountAmount) || 0,
      deliveryMethod: deliveryMethod || undefined,
    };
    if (docType !== 'quotation') {
      body.paymentType = paymentType || undefined;
      body.deliveryDate = deliveryDate || undefined;
    }
    if (docType === 'quotation') {
      body.validUntil = validUntil || undefined;
    }
    if (docType === 'invoice') {
      body.dueDate = dueDate || undefined;
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
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted">Items</span>
          {items.map((item, i) => (
            <div key={item._key} className="grid grid-cols-[1fr_80px_100px_24px] gap-2 items-center">
              <select
                className={inputClass}
                value={item.finishedGoodId}
                onChange={(e) => {
                  const fg = finishedGoods.find((f) => f.id === e.target.value);
                  updateItem(i, {
                    finishedGoodId: e.target.value,
                    description: fg?.name || item.description,
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
                step={quantityInputStep(finishedGoods.find((f) => f.id === item.finishedGoodId)?.unit)}
                min={quantityInputStep(finishedGoods.find((f) => f.id === item.finishedGoodId)?.unit)}
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateItem(i, { quantity: e.target.value })}
                onBlur={(e) =>
                  updateItem(i, {
                    quantity: String(snapQuantityToUnit(Number(e.target.value) || 0, finishedGoods.find((f) => f.id === item.finishedGoodId)?.unit)),
                  })
                }
              />
              <input
                className={inputClass}
                type="number"
                step="0.001"
                min="0"
                placeholder="Unit price"
                value={item.unitPrice}
                onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="text-muted hover:text-red-600 text-lg leading-none"
                title="Remove item"
              >
                &times;
              </button>
            </div>
          ))}
          <SecondaryButton onClick={addItem}>+ Add item</SecondaryButton>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {docType !== 'quotation' && (
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
          )}
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount (OMR)">
            <input
              className={inputClass}
              type="number"
              step="0.001"
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
            />
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
          {(docType === 'invoice' || docType === 'delivery_note') && (
            <Field label="Delivery date">
              <input
                className={`${inputClass} ${!deliveryDateEnabled ? 'bg-black/5 text-muted cursor-not-allowed' : ''}`}
                type="date"
                value={deliveryDate}
                disabled={!deliveryDateEnabled}
                title={!deliveryDateEnabled ? 'Only settable when delivery method is "Delivery on Site"' : undefined}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>
          )}
        </div>

        {docType === 'invoice' && (
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
              <input type="checkbox" checked={vatExcluded} onChange={(e) => setVatExcluded(e.target.checked)} />
              VAT excluded for this invoice
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
