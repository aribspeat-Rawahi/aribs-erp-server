import { FormEvent, useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Download, MessageCircle, Share2, Trash2, Truck, Wallet, Bell, RotateCcw, Check, X } from 'lucide-react';
import api from '../api/client';
import { viewPdf, downloadPdf, openWhatsapp, sharePdf } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { Can } from '../components/Permission';
import { labelFor, PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS } from '../constants';
import NewDocumentModal, { ExistingDoc } from '../components/NewDocumentModal';
import { formatQuantity, quantityInputStep, snapQuantityToUnit } from '../utils/formatQuantity';

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
interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  total: number;
  paidAmount?: number;
  paymentStatus: string;
  paymentType?: string;
  deliveryMethod?: string;
  discountAmount?: number;
  dueDate?: string;
  vatExcluded?: boolean;
  template?: string;
  items?: { finishedGoodId?: string; description: string; quantity: number; unitPrice: number }[];
}

interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentType?: string;
  paymentDate: string;
  note?: string;
}
interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}
interface SalesReturnItem {
  id: string;
  finishedGoodId: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
}
interface SalesReturn {
  id: string;
  returnNumber: string;
  invoiceId: string;
  customerId: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string;
  reason?: string;
  subtotal: number | string;
  vatAmount: number | string;
  total: number | string;
  bankAccountId?: string;
  requestedByEmail?: string;
  decidedByEmail?: string;
  decidedAt?: string;
  rejectionReason?: string;
  items: SalesReturnItem[];
}

const paymentStatusTone: Record<string, string> = {
  paid: 'bg-brand-50 text-brand-700',
  partial: 'bg-amber-50 text-amber-700',
  due: 'bg-red-50 text-red-600',
};

const returnStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

export default function Invoices() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin', 'accountant']);
  const canDecide = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [tab, setTab] = useState<'invoices' | 'returns'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [returningInvoice, setReturningInvoice] = useState<Invoice | null>(null);
  const [rejectingReturn, setRejectingReturn] = useState<SalesReturn | null>(null);

  function load() {
    setLoading(true);
    api.get('/invoices').then((res) => setInvoices(res.data)).finally(() => setLoading(false));
  }
  function loadReturns() {
    setReturnsLoading(true);
    api.get('/sales-returns').then((res) => setReturns(res.data)).finally(() => setReturnsLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
    api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
  }, []);

  useEffect(() => {
    if (tab === 'returns') loadReturns();
  }, [tab]);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    try {
      await api.delete(`/invoices/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this invoice.');
    }
  }

  // The list endpoint doesn't include line items — fetch the full
  // document (which does) before opening the return picker, same as
  // startEdit does for the edit form.
  async function startReturn(inv: Invoice) {
    const res = await api.get(`/invoices/${inv.id}`);
    setReturningInvoice(res.data);
  }

  async function removeReturn(id: string) {
    if (!window.confirm('Delete this sales return request? This cannot be undone.')) return;
    try {
      await api.delete(`/sales-returns/${id}`);
      loadReturns();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this return.');
    }
  }

  async function approveReturn(id: string) {
    try {
      await api.post(`/sales-returns/${id}/approve`);
      loadReturns();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not approve this return.');
    }
  }

  async function convert(id: string) {
    if (!window.confirm('Convert this invoice into a delivery note?')) return;
    try {
      await api.post(`/invoices/${id}/convert-to-delivery-note`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not convert this invoice to a delivery note.');
    }
  }

  async function sendReminder(id: string) {
    try {
      await api.post(`/invoices/${id}/send-reminder`);
      window.alert('Reminder email sent.');
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not send the reminder.');
    }
  }

  // The list endpoint doesn't include line items — fetch the full
  // document (which does) before opening the edit form.
  async function startEdit(inv: Invoice) {
    const res = await api.get(`/invoices/${inv.id}`);
    setEditing(res.data);
  }

  const existing: ExistingDoc | undefined = editing
    ? {
        id: editing.id,
        items: editing.items,
        paymentType: editing.paymentType,
        deliveryMethod: editing.deliveryMethod,
        discountAmount: editing.discountAmount,
        dueDate: editing.dueDate,
        vatExcluded: editing.vatExcluded,
        template: editing.template,
      }
    : undefined;

  return (
    <div>
      <div className="mb-4">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as any)}
          options={[
            { value: 'invoices', label: 'Invoices' },
            { value: 'returns', label: 'Sales Returns' },
          ]}
        />
      </div>

      {tab === 'invoices' ? (
        <>
      <PageHeader
        title="Invoices"
        subtitle="Tax invoices issued to customers"
        action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNew(true)}>New invoice</PrimaryButton>}
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : invoices.length === 0 ? (
        <EmptyState>No invoices yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">{inv.invoiceNumber}</div>
                  <div className="text-xs text-muted">
                    {customerName(inv.customerId)} · {labelFor(PAYMENT_TYPE_OPTIONS, inv.paymentType)} · {labelFor(DELIVERY_METHOD_OPTIONS, inv.deliveryMethod)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-ink">{Number(inv.total).toFixed(3)} OMR</div>
                    {inv.paymentStatus !== 'paid' && Number(inv.paidAmount) > 0 && (
                      <div className="text-xs text-muted">Paid {Number(inv.paidAmount).toFixed(3)}</div>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${paymentStatusTone[inv.paymentStatus] || 'bg-black/5 text-ink/70'}`}>
                      {inv.paymentStatus}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <IconButton icon={Eye} title="View PDF" onClick={() => viewPdf(`/invoices/${inv.id}/pdf`)} />
                    <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => startEdit(inv)} />
                    <IconButton icon={Download} title="Download PDF" onClick={() => downloadPdf(`/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`)} />
                    <IconButton icon={MessageCircle} title="Send on WhatsApp" onClick={() => openWhatsapp(`/invoices/${inv.id}/whatsapp-link`)} />
                    <IconButton icon={Share2} title="Share PDF (attach the file)" onClick={() => sharePdf(`/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`, `Invoice ${inv.invoiceNumber}`)} />
                    <IconButton
                      icon={Wallet}
                      tone={inv.paymentStatus === 'paid' ? 'success' : 'default'}
                      title="Record payment"
                      onClick={() => setPayingInvoice(inv)}
                    />
                    <IconButton icon={Truck} title="Convert to delivery note" requires="edit" onClick={() => convert(inv.id)} />
                    <IconButton icon={RotateCcw} title="Return items from this invoice" requires="edit" onClick={() => startReturn(inv)} />
                    {inv.paymentStatus !== 'paid' && inv.dueDate && (
                      <IconButton icon={Bell} title="Send payment reminder now" requires="edit" onClick={() => sendReminder(inv.id)} />
                    )}
                    {canDelete && (
                      <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => remove(inv.id)} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showNew && (
        <NewDocumentModal
          docType="invoice"
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
        <NewDocumentModal
          docType="invoice"
          customers={customers}
          finishedGoods={finishedGoods}
          existing={existing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {payingInvoice && (
        <PaymentLedgerModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
          onChanged={load}
        />
      )}
      {returningInvoice && (
        <NewSalesReturnModal
          invoice={returningInvoice}
          finishedGoods={finishedGoods}
          bankAccounts={bankAccounts}
          onClose={() => setReturningInvoice(null)}
          onSaved={() => {
            setReturningInvoice(null);
            load();
          }}
        />
      )}
        </>
      ) : (
        <>
          <PageHeader
            title="Sales Returns"
            subtitle="Items returned by customers, with pending/approved/rejected status"
          />
          {returnsLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : returns.length === 0 ? (
            <EmptyState>No sales returns yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{customerName(r.customerId)}</div>
                      <div className="text-xs text-muted">
                        {r.returnNumber} · {r.date}
                        {r.reason ? ` · ${r.reason}` : ''}
                        {r.status === 'rejected' && r.rejectionReason ? ` · Rejected: ${r.rejectionReason}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-ink">{Number(r.total).toFixed(3)} OMR</div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${returnStatusTone[r.status] || 'bg-black/5 text-ink/70'}`}>
                        {r.status}
                      </span>
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Trash2} tone="danger" title="Delete return" requires="full" onClick={() => removeReturn(r.id)} />
                          {canDecide && (
                            <>
                              <IconButton icon={Check} tone="success" title="Approve" requires="edit" requiresModule="approvals" onClick={() => approveReturn(r.id)} />
                              <IconButton icon={X} tone="danger" title="Reject" requires="edit" requiresModule="approvals" onClick={() => setRejectingReturn(r)} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {rejectingReturn && (
            <RejectSalesReturnModal
              item={rejectingReturn}
              onClose={() => setRejectingReturn(null)}
              onSaved={() => {
                setRejectingReturn(null);
                loadReturns();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// Payment Ledger — an invoice can be settled in several installments, so
// this shows every payment recorded so far plus a form to add another.
// Recording/removing a payment immediately updates the invoice's
// paidAmount/paymentStatus on the backend; `onChanged` refreshes the
// Invoices list so the badge/Paid line stay in sync while this stays open.
function PaymentLedgerModal({
  invoice,
  onClose,
  onChanged,
}: {
  invoice: Invoice;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(Number(invoice.total));
  const [paidAmount, setPaidAmount] = useState(Number(invoice.paidAmount || 0));

  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get(`/invoices/${invoice.id}/payments`)
      .then((res) => setPayments(res.data))
      .finally(() => setLoading(false));
    // Re-fetch the invoice itself too, since paidAmount/total may have
    // moved (e.g. total, if it was edited elsewhere) since this opened.
    api.get(`/invoices/${invoice.id}`).then((res) => {
      setTotal(Number(res.data.total));
      setPaidAmount(Number(res.data.paidAmount || 0));
    });
  }

  useEffect(load, [invoice.id]);

  const remaining = Math.max(0, total - paidAmount);

  async function addPayment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/invoices/${invoice.id}/payments`, {
        amount: Number(amount),
        paymentType,
        paymentDate,
        note: note || undefined,
      });
      setAmount('');
      setNote('');
      load();
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not record this payment.');
    } finally {
      setBusy(false);
    }
  }

  async function removePayment(id: string) {
    if (!window.confirm('Remove this payment entry? This cannot be undone.')) return;
    await api.delete(`/invoices/${invoice.id}/payments/${id}`);
    load();
    onChanged();
  }

  return (
    <Modal title={`Payment Ledger — ${invoice.invoiceNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Invoice Total</div>
            <div className="font-semibold text-ink">{total.toFixed(3)} OMR</div>
          </div>
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Paid So Far</div>
            <div className="font-semibold text-brand-700">{paidAmount.toFixed(3)} OMR</div>
          </div>
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Remaining Balance</div>
            <div className={`font-semibold ${remaining > 0 ? 'text-red-600' : 'text-brand-700'}`}>{remaining.toFixed(3)} OMR</div>
          </div>
        </div>

        <div>
          <span className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">Payments Recorded</span>
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted">No payments recorded yet.</p>
          ) : (
            <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium text-ink">{Number(p.amount).toFixed(3)} OMR</div>
                    <div className="text-xs text-muted">
                      {p.paymentDate} · {labelFor(PAYMENT_TYPE_OPTIONS, p.paymentType)}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                  </div>
                  <IconButton icon={Trash2} tone="danger" title="Remove" requires="full" onClick={() => removePayment(p.id)} />
                </div>
              ))}
            </div>
          )}
        </div>

        {remaining > 0 ? (
          <Can>
          <form onSubmit={addPayment} className="space-y-3 border-t border-black/10 pt-3">
            <span className="block text-xs font-semibold text-muted uppercase tracking-wide">Record a Payment</span>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Amount (max ${remaining.toFixed(3)} OMR)`}>
                <input
                  className={inputClass}
                  type="number"
                  min="0.001"
                  max={remaining}
                  step="0.001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
              <Field label="Payment Date">
                <input className={inputClass} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Type">
                <select className={inputClass} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                  {PAYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Note (optional)">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cheque number" />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Recording…' : 'Record Payment'}</PrimaryButton>
            </div>
          </form>
          </Can>
        ) : (
          <p className="text-sm text-brand-700 border-t border-black/10 pt-3">This invoice is fully paid.</p>
        )}

        <div className="flex justify-end pt-1">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Picks which sold products (and how much) to take back from the
// customer. Only finishedGoodId + quantity go to the backend — price/VAT
// are always copied server-side from the original invoice line, so this
// stays a simple quantity picker. Lines with the same product across
// multiple invoice rows are combined into one entry here, matching how
// the backend checks the returnable cap. Free-text lines (no linked
// product) can't be returned and are left out.
function NewSalesReturnModal({
  invoice,
  finishedGoods,
  bankAccounts,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  finishedGoods: FinishedGood[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(() => {
    const byProduct = new Map<string, number>();
    for (const it of invoice.items || []) {
      if (!it.finishedGoodId) continue;
      byProduct.set(it.finishedGoodId, (byProduct.get(it.finishedGoodId) || 0) + Number(it.quantity));
    }
    return Array.from(byProduct.entries()).map(([finishedGoodId, maxQty]) => ({
      finishedGoodId,
      maxQty,
      quantity: '0',
    }));
  });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function productName(id: string) {
    return finishedGoods.find((f) => f.id === id)?.name || id;
  }
  function productUnit(id: string) {
    return finishedGoods.find((f) => f.id === id)?.unit;
  }

  function updateQty(i: number, quantity: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, quantity } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const lines = items
      .filter((it) => Number(it.quantity) > 0)
      .map((it) => ({ finishedGoodId: it.finishedGoodId, quantity: Number(it.quantity) }));
    if (lines.length === 0) {
      setError('Enter a return quantity for at least one item.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/sales-returns', {
        invoiceId: invoice.id,
        items: lines,
        date,
        reason: reason || undefined,
        bankAccountId: bankAccountId || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create this return.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Return items — ${invoice.invoiceNumber}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted">
            No returnable line items on this invoice — only free-text lines with no linked product.
          </p>
        ) : (
          <div className="border border-black/10 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-xs text-muted">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Sold qty</th>
                  <th className="text-right px-3 py-2">Return qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {items.map((it, i) => (
                  <tr key={it.finishedGoodId}>
                    <td className="px-3 py-2">{productName(it.finishedGoodId)}</td>
                    <td className="px-3 py-2 text-right">{formatQuantity(it.maxQty, productUnit(it.finishedGoodId))}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step={quantityInputStep(productUnit(it.finishedGoodId))}
                        min="0"
                        max={Number(it.maxQty)}
                        value={it.quantity}
                        onChange={(e) => updateQty(i, e.target.value)}
                        onBlur={(e) => updateQty(i, String(snapQuantityToUnit(Number(e.target.value) || 0, productUnit(it.finishedGoodId))))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Reason (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Refund from account (optional — auto-withdraws on approval)">
          <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">— Credit against Accounts Receivable only —</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({Number(a.currentBalance).toFixed(3)} OMR)
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy || items.length === 0}>{busy ? 'Saving…' : 'Submit return'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RejectSalesReturnModal({
  item,
  onClose,
  onSaved,
}: {
  item: SalesReturn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/sales-returns/${item.id}/reject`, { reason });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not reject this return.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Reject return" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Reason">
          <input className={inputClass} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" requiresModule="approvals" disabled={busy}>{busy ? 'Saving…' : 'Reject'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
