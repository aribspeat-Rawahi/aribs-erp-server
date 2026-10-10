import { FormEvent, useEffect, useState } from 'react';
import { Award, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Card, EmptyState, Field, IconButton, Modal, PrimaryButton, SecondaryButton, inputClass } from '../components/ui';
import { formatQuantityWithUnit, normalizeUnit, quantityInputMin, quantityInputStep, unitLabel } from '../utils/formatQuantity';

interface Supplier {
  id: string;
  name: string;
  vatStatus?: string;
}
interface RawMaterial {
  id: string;
  name: string;
  unit?: string;
}
interface RfqListRow {
  id: string;
  rfqNumber: string;
  title: string;
  status: 'open' | 'awarded' | 'cancelled';
  quotesDueBy?: string | null;
  prNumber?: string | null;
  quoteCount: number;
  lowestTotal: number | null;
  purchaseOrder?: { id: string; poNumber: string; status: string } | null;
  createdAt: string;
}
interface RfqItemView {
  id: string;
  rawMaterialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  lowestPrice: number | null;
  lowestQuoteIds: string[];
}
interface QuoteView {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierVatRegistered: boolean;
  quoteReference?: string | null;
  quoteDate?: string | null;
  validUntil?: string | null;
  deliveryDays?: number | null;
  notes?: string | null;
  lines: { rfqItemId: string; unitPrice: number }[];
  subtotal: number;
  vatAmount: number;
  total: number;
  complete: boolean;
  expired: boolean;
}
interface RfqView extends Omit<RfqListRow, 'quoteCount' | 'lowestTotal'> {
  notes?: string | null;
  awardedQuoteId?: string | null;
  awardReason?: string | null;
  items: RfqItemView[];
  quotes: QuoteView[];
  lowestQuoteId: string | null;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Collecting quotes', tone: 'bg-amber-50 text-amber-700' },
  awarded: { label: 'Supplier chosen', tone: 'bg-brand-50 text-brand-700' },
  cancelled: { label: 'Cancelled', tone: 'bg-black/5 text-ink/60' },
};
const money = (n: number | string | null | undefined) => Number(n || 0).toFixed(3);

// Suppliers > RFQs
export default function RfqPanel({ suppliers, rawMaterials, onOpenOrders }: { suppliers: Supplier[]; rawMaterials: RawMaterial[]; onOpenOrders: () => void }) {
  const [rows, setRows] = useState<RfqListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/rfqs').then((r) => setRows(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <PrimaryButton icon={Plus} requires="edit" onClick={() => setCreating(true)}>New RFQ</PrimaryButton>
      </div>
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState>No requests for quotation yet. Start one here, or with "Get quotes" on an approved requisition.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {rows.map((r) => {
              const st = STATUS[r.status];
              return (
                <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-ink whitespace-nowrap">{r.rfqNumber}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.tone}`}>{st.label}</span>
                    </div>
                    <div className="text-sm text-ink/80">{r.title}</div>
                    <div className="text-xs text-muted">
                      {r.quoteCount} quote{r.quoteCount === 1 ? '' : 's'}
                      {r.lowestTotal !== null ? ` · lowest ${money(r.lowestTotal)} OMR` : ''}
                      {r.prNumber ? ` · ${r.prNumber}` : ''}
                      {r.quotesDueBy ? ` · quotes due ${r.quotesDueBy}` : ''}
                      {r.purchaseOrder ? ` · ${r.purchaseOrder.poNumber} (${r.purchaseOrder.status.replace('_', ' ')})` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SecondaryButton icon={Eye} onClick={() => setOpenId(r.id)}>{r.status === 'open' ? 'Quotes & compare' : 'View'}</SecondaryButton>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {creating && (
        <NewRfqModal
          rawMaterials={rawMaterials}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            load();
            setOpenId(id);
          }}
        />
      )}
      {openId && (
        <RfqModal
          id={openId}
          suppliers={suppliers}
          onClose={() => {
            setOpenId(null);
            load();
          }}
          onOpenOrders={onOpenOrders}
        />
      )}
    </div>
  );
}

function NewRfqModal({ rawMaterials, onClose, onSaved }: { rawMaterials: RawMaterial[]; onClose: () => void; onSaved: (id: string) => void }) {
  const unitOf = (id: string) => normalizeUnit(rawMaterials.find((m) => m.id === id)?.unit);
  const [title, setTitle] = useState('');
  const [quotesDueBy, setQuotesDueBy] = useState('');
  const [items, setItems] = useState([{ key: 'n0', rawMaterialId: rawMaterials[0]?.id || '', quantity: '1' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/rfqs', { title, quotesDueBy: quotesDueBy || undefined, items: items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity) })) });
      onSaved(r.data.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create the RFQ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New request for quotation" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Title">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coir fibre for November" required maxLength={200} />
          </Field>
          <Field label="Quotes due by (optional)">
            <input className={inputClass} type="date" value={quotesDueBy} onChange={(e) => setQuotesDueBy(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => {
            const unit = unitOf(it.rawMaterialId);
            return (
              <div key={it.key} className="grid grid-cols-[1fr_90px_56px_24px] gap-2 items-center">
                <select className={inputClass} value={it.rawMaterialId} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, rawMaterialId: e.target.value } : x)))}>
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <input className={inputClass} type="number" step={quantityInputStep(unit)} min={quantityInputMin(unit)} value={it.quantity} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} required />
                <div className="h-full flex items-center justify-center rounded-lg bg-black/5 text-sm text-ink/70">{unitLabel(unit)}</div>
                {items.length > 1 ? (
                  <button type="button" className="text-muted hover:text-red-600" title="Remove line" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>&times;</button>
                ) : <span />}
              </div>
            );
          })}
          <SecondaryButton onClick={() => setItems((p) => [...p, { key: `n${Date.now()}`, rawMaterialId: rawMaterials[0]?.id || '', quantity: '1' }])}>+ Add item</SecondaryButton>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Create RFQ'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RfqModal({ id, suppliers, onClose, onOpenOrders }: { id: string; suppliers: Supplier[]; onClose: () => void; onOpenOrders: () => void }) {
  const [rfq, setRfq] = useState<RfqView | null>(null);
  const [quoteEdit, setQuoteEdit] = useState<QuoteView | 'new' | null>(null);
  const [awarding, setAwarding] = useState<QuoteView | null>(null);

  function load() {
    api.get(`/rfqs/${id}`).then((r) => setRfq(r.data));
  }
  useEffect(load, [id]);

  if (!rfq) return null;
  const open = rfq.status === 'open';

  async function removeQuote(q: QuoteView) {
    if (!window.confirm(`Remove ${q.supplierName}'s quote?`)) return;
    try {
      setRfq((await api.delete(`/rfqs/${id}/quotes/${q.id}`)).data);
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not remove the quote.');
    }
  }
  async function cancelRfq() {
    if (!window.confirm('Cancel this RFQ? No supplier will be chosen.')) return;
    try {
      setRfq((await api.post(`/rfqs/${id}/cancel`)).data);
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not cancel the RFQ.');
    }
  }

  return (
    <Modal title={`${rfq.rfqNumber} — ${rfq.title}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS[rfq.status].tone}`}>{STATUS[rfq.status].label}</span>
          {rfq.prNumber && <span>For {rfq.prNumber}</span>}
          {rfq.quotesDueBy && <span>· Quotes due {rfq.quotesDueBy}</span>}
        </div>
        {rfq.status === 'awarded' && (
          <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
            Chosen: {rfq.quotes.find((q) => q.id === rfq.awardedQuoteId)?.supplierName}
            {rfq.purchaseOrder ? ` → ${rfq.purchaseOrder.poNumber} (${rfq.purchaseOrder.status.replace('_', ' ')})` : ''}
            {rfq.awardReason ? <div className="text-xs mt-0.5">Reason: {rfq.awardReason}</div> : null}
            {rfq.purchaseOrder && (
              <button type="button" className="block text-xs underline mt-1" onClick={() => { onClose(); onOpenOrders(); }}>
                Open Purchase Orders
              </button>
            )}
          </div>
        )}

        {rfq.quotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 p-4 text-sm text-muted">
            Items: {rfq.items.map((i) => `${i.materialName} ${formatQuantityWithUnit(i.quantity, i.unit)}`).join(' · ')}
            <div className="mt-1">No quotes yet - add each supplier's prices as they come in.</div>
          </div>
        ) : (
          <div className="border border-black/10 rounded-lg overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 220 + rfq.quotes.length * 150 }}>
              <thead className="bg-black/5 text-xs text-muted">
                <tr>
                  <th className="text-left px-3 py-2">Item</th>
                  {rfq.quotes.map((q) => (
                    <th key={q.id} className="text-right px-3 py-2 align-top">
                      <div className="font-semibold text-ink">{q.supplierName}</div>
                      <div>{q.quoteReference || 'no ref.'}</div>
                      {rfq.lowestQuoteId === q.id && <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500 text-ink">Lowest</span>}
                      {q.expired && <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">Expired</span>}
                      {!q.complete && <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">Incomplete</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {rfq.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      {it.materialName}
                      <div className="text-xs text-muted">{formatQuantityWithUnit(it.quantity, it.unit)}</div>
                    </td>
                    {rfq.quotes.map((q) => {
                      const line = q.lines.find((l) => l.rfqItemId === it.id);
                      const best = it.lowestQuoteIds.includes(q.id);
                      return (
                        <td key={q.id} className={`px-3 py-2 text-right ${best ? 'bg-brand-50/70' : ''}`}>
                          {line ? (
                            <>
                              <div className={best ? 'font-semibold text-brand-700' : ''}>{money(line.unitPrice)}</div>
                              <div className="text-xs text-muted">{money(line.unitPrice * it.quantity)}</div>
                            </>
                          ) : (
                            <span className="text-xs text-muted">not quoted</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm border-t border-black/10">
                <tr>
                  <td className="px-3 py-1.5 text-muted">Subtotal</td>
                  {rfq.quotes.map((q) => <td key={q.id} className="px-3 py-1.5 text-right">{money(q.subtotal)}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-1.5 text-muted">VAT</td>
                  {rfq.quotes.map((q) => <td key={q.id} className="px-3 py-1.5 text-right">{q.supplierVatRegistered ? money(q.vatAmount) : 'none'}</td>)}
                </tr>
                <tr className="font-semibold">
                  <td className="px-3 py-1.5">Total to pay</td>
                  {rfq.quotes.map((q) => <td key={q.id} className="px-3 py-1.5 text-right">{money(q.total)}</td>)}
                </tr>
                <tr className="text-xs text-muted">
                  <td className="px-3 py-1.5">Delivery / valid until</td>
                  {rfq.quotes.map((q) => (
                    <td key={q.id} className="px-3 py-1.5 text-right">
                      {q.deliveryDays !== null && q.deliveryDays !== undefined ? `${q.deliveryDays} days` : '-'} / {q.validUntil || '-'}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr>
                    <td className="px-3 py-2" />
                    {rfq.quotes.map((q) => (
                      <td key={q.id} className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <IconButton icon={Award} tone="success" title="Choose this quote" requires="edit" onClick={() => setAwarding(q)} />
                          <IconButton icon={Pencil} title="Edit quote" requires="edit" onClick={() => setQuoteEdit(q)} />
                          <IconButton icon={Trash2} tone="danger" title="Remove quote" requires="edit" onClick={() => removeQuote(q)} />
                        </div>
                      </td>
                    ))}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          Totals include 5% VAT only for VAT-registered suppliers - quotes are compared on what will actually be paid. The chosen quote becomes a purchase order, which then goes for approval.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {open && <SecondaryButton requires="edit" onClick={cancelRfq}>Cancel RFQ</SecondaryButton>}
          {open && <PrimaryButton icon={Plus} requires="edit" onClick={() => setQuoteEdit('new')}>Add supplier quote</PrimaryButton>}
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
      {quoteEdit && (
        <QuoteModal
          rfq={rfq}
          quote={quoteEdit === 'new' ? null : quoteEdit}
          suppliers={suppliers}
          onClose={() => setQuoteEdit(null)}
          onSaved={(v) => {
            setQuoteEdit(null);
            setRfq(v);
          }}
        />
      )}
      {awarding && (
        <AwardModal
          rfq={rfq}
          quote={awarding}
          onClose={() => setAwarding(null)}
          onSaved={(v) => {
            setAwarding(null);
            setRfq(v);
          }}
        />
      )}
    </Modal>
  );
}

function QuoteModal({ rfq, quote, suppliers, onClose, onSaved }: { rfq: RfqView; quote: QuoteView | null; suppliers: Supplier[]; onClose: () => void; onSaved: (v: RfqView) => void }) {
  const taken = new Set(rfq.quotes.filter((q) => q.id !== quote?.id).map((q) => q.supplierId));
  const choices = suppliers.filter((s) => !taken.has(s.id));
  const [supplierId, setSupplierId] = useState(quote?.supplierId || choices[0]?.id || '');
  const [quoteReference, setRef] = useState(quote?.quoteReference || '');
  const [quoteDate, setQuoteDate] = useState(quote?.quoteDate || '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil || '');
  const [deliveryDays, setDeliveryDays] = useState(quote?.deliveryDays?.toString() || '');
  const [notes, setNotes] = useState(quote?.notes || '');
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(rfq.items.map((i) => [i.id, quote?.lines.find((l) => l.rfqItemId === i.id)?.unitPrice?.toString() || ''])),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const vatReg = suppliers.find((s) => s.id === supplierId)?.vatStatus === 'registered';
  const sub = rfq.items.reduce((t, i) => t + (prices[i.id] === '' ? 0 : Math.round(Number(prices[i.id]) * i.quantity * 1000) / 1000), 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const payload = {
      supplierId,
      quoteReference: quoteReference || undefined,
      quoteDate: quoteDate || undefined,
      validUntil: validUntil || undefined,
      deliveryDays: deliveryDays === '' ? undefined : Number(deliveryDays),
      notes: notes || undefined,
      lines: rfq.items.filter((i) => prices[i.id] !== '').map((i) => ({ rfqItemId: i.id, unitPrice: Number(prices[i.id]) })),
    };
    try {
      const r = quote ? await api.patch(`/rfqs/${rfq.id}/quotes/${quote.id}`, payload) : await api.post(`/rfqs/${rfq.id}/quotes`, payload);
      onSaved(r.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save the quote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={quote ? `Edit quote — ${quote.supplierName}` : 'Add supplier quote'} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Supplier's quote no. (optional)">
            <input className={inputClass} value={quoteReference} onChange={(e) => setRef(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Quote date (optional)">
            <input className={inputClass} type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
          </Field>
          <Field label="Valid until (optional)">
            <input className={inputClass} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Delivery in (days, optional)">
            <input className={inputClass} type="number" min="0" max="365" step="1" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="border border-black/10 rounded-lg divide-y divide-black/5">
          {rfq.items.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_130px] items-center gap-2 px-3 py-2">
              <div className="text-sm">
                {i.materialName}
                <div className="text-xs text-muted">{formatQuantityWithUnit(i.quantity, i.unit)}</div>
              </div>
              <input
                className={inputClass}
                type="number"
                step="0.001"
                min="0"
                placeholder="Price per unit"
                value={prices[i.id]}
                onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="text-xs text-muted">
          Subtotal {sub.toFixed(3)} OMR{vatReg ? ` + VAT ${(Math.round(sub * 0.05 * 1000) / 1000).toFixed(3)}` : ' (supplier not VAT registered - no VAT)'} · leave a price empty if the supplier did not quote that item.
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy || !supplierId}>{busy ? 'Saving…' : 'Save quote'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AwardModal({ rfq, quote, onClose, onSaved }: { rfq: RfqView; quote: QuoteView; onClose: () => void; onSaved: (v: RfqView) => void }) {
  const lowest = rfq.quotes.find((q) => q.id === rfq.lowestQuoteId);
  const needsReason = !!lowest && lowest.id !== quote.id;
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/rfqs/${rfq.id}/award`, { quoteId: quote.id, reason: reason || undefined, expectedDate: expectedDate || undefined });
      onSaved(r.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not choose this quote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Choose ${quote.supplierName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80">
          A purchase order for <span className="font-semibold">{money(quote.total)} OMR</span> will be made at these prices and sent for approval.
        </div>
        {needsReason && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {lowest!.supplierName} is lower ({money(lowest!.total)} OMR, {money(quote.total - lowest!.total)} less). Say why this quote is chosen - it is kept with the RFQ for audit.
          </div>
        )}
        <Field label={needsReason ? 'Reason for choosing this quote' : 'Reason (optional)'}>
          <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} maxLength={1000} />
        </Field>
        <Field label="Expected delivery (optional)">
          <input className={inputClass} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Make purchase order'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
