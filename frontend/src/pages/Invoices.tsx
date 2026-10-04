import { FormEvent, useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Download, MessageCircle, Share2, Trash2, Truck, Wallet, Bell, RotateCcw, Check, X } from 'lucide-react';
import api from '../api/client';
import { viewPdf, downloadPdf, openWhatsapp, sharePdf } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { Can } from '../components/Permission';
import { labelFor, PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS } from '../constants';
import NewDocumentModal, { ExistingDoc } from '../components/NewDocumentModal';
import { formatQuantityWithUnit, quantityInputStep, snapQuantityToUnit } from '../utils/formatQuantity';

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
  deliveryDate?: string;
  vatExcluded?: boolean;
  template?: string;
  deliveryStatus?: string;
  waitingForStock?: boolean;
  stockReadyAt?: string | null;
  items?: { finishedGoodId?: string; description: string; quantity: number; unit?: string; unitPrice: number }[];
}

interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: number;
  paymentType?: string;
  paymentDate: string;
  note?: string;
  // set = credit note from an approved sales return (not money received)
  salesReturnId?: string | null;
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
  unit?: string;
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
  appliedToInvoice?: number | string;
  refundAmount?: number | string;
  items: SalesReturnItem[];
}

const paymentStatusTone: Record<string, string> = {
  paid: 'bg-brand-50 text-brand-700',
  partial: 'bg-amber-50 text-amber-700',
  due: 'bg-red-50 text-red-600',
};

const returnStatusLabel: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved — added to stock',
  rejected: 'Rejected',
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
  const [approvingReturn, setApprovingReturn] = useState<SalesReturn | null>(null);

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
    if (tab === 'returns') {
      loadReturns();
      load(); // invoice numbers for the return rows
    }
  }, [tab]);

  function invoiceNumber(id: string) {
    return invoices.find((i) => i.id === id)?.invoiceNumber || '';
  }

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  // "Cement x 10 Bags, Sand x 2.500 Tons" - the line's own unit, else the product's.
  function returnItemsSummary(r: SalesReturn) {
    return (r.items || [])
      .map((it) => {
        const fg = finishedGoods.find((f) => f.id === it.finishedGoodId);
        return `${fg?.name || 'Item'} x ${formatQuantityWithUnit(it.quantity, it.unit || fg?.unit)}`;
      })
      .join(', ');
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
        deliveryDate: editing.deliveryDate,
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
              <div key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-ink whitespace-nowrap">{inv.invoiceNumber}</span>
                    <DeliveryBadge invoice={inv} />
                  </div>
                  <div className="text-xs text-muted">
                    {customerName(inv.customerId)} · {labelFor(PAYMENT_TYPE_OPTIONS, inv.paymentType)} · {labelFor(DELIVERY_METHOD_OPTIONS, inv.deliveryMethod)}
                    {inv.deliveryDate && inv.deliveryStatus !== 'delivered' ? ` · Delivery ${inv.deliveryDate}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
                  <div className="sm:text-right">
                    <div className="text-sm font-semibold text-ink">{Number(inv.total).toFixed(3)} OMR</div>
                    {inv.paymentStatus !== 'paid' && Number(inv.paidAmount) > 0 && (
                      <div className="text-xs text-muted">Paid {Number(inv.paidAmount).toFixed(3)}</div>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${paymentStatusTone[inv.paymentStatus] || 'bg-black/5 text-ink/70'}`}>
                      {inv.paymentStatus}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                  <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{customerName(r.customerId)}</div>
                      <div className="text-xs text-muted">
                        {r.returnNumber} · {r.date}
                        {invoiceNumber(r.invoiceId) ? ` · ${invoiceNumber(r.invoiceId)}` : ''}
                        {r.reason ? ` · ${r.reason}` : ''}
                        {r.status === 'rejected' && r.rejectionReason ? ` · Rejected: ${r.rejectionReason}` : ''}
                      </div>
                      {!!r.items?.length && <div className="text-xs text-muted break-words">{returnItemsSummary(r)}</div>}
                      {r.status === 'approved' && (
                        <div className="text-xs text-muted">
                          Credit on invoice {Number(r.appliedToInvoice || 0).toFixed(3)} OMR
                          {Number(r.refundAmount || 0) > 0 ? ` · Refunded ${Number(r.refundAmount).toFixed(3)} OMR` : ''}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(r.total).toFixed(3)} OMR</div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${returnStatusTone[r.status] || 'bg-black/5 text-ink/70'}`}>
                        {returnStatusLabel[r.status] || r.status}
                      </span>
                      {r.status === 'approved' && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Eye} title="View credit note" onClick={() => viewPdf(`/sales-returns/${r.id}/pdf`)} />
                          <IconButton icon={Download} title="Download credit note" onClick={() => downloadPdf(`/sales-returns/${r.id}/pdf`, `Credit-Note-${r.returnNumber}.pdf`)} />
                        </div>
                      )}
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Trash2} tone="danger" title="Delete return" requires="full" onClick={() => removeReturn(r.id)} />
                          {canDecide && (
                            <>
                              <IconButton icon={Check} tone="success" title="Approve & add to stock" requires="edit" requiresModule="approvals" onClick={() => setApprovingReturn(r)} />
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
          {approvingReturn && (
            <ApproveSalesReturnModal
              item={approvingReturn}
              invoiceNumber={invoiceNumber(approvingReturn.invoiceId)}
              summary={returnItemsSummary(approvingReturn)}
              bankAccounts={bankAccounts}
              onClose={() => setApprovingReturn(null)}
              onSaved={() => {
                setApprovingReturn(null);
                loadReturns();
                load();
                api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
              }}
            />
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
    try {
      await api.delete(`/invoices/${invoice.id}/payments/${id}`);
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not remove this payment.');
    }
    load();
    onChanged();
  }

  return (
    <Modal title={`Payment Ledger — ${invoice.invoiceNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
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
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="text-sm min-w-0">
                    <div className="font-medium text-ink">{Number(p.amount).toFixed(3)} OMR</div>
                    <div className="text-xs text-muted">
                      {p.paymentDate} · {p.salesReturnId ? 'Credit note (sales return)' : labelFor(PAYMENT_TYPE_OPTIONS, p.paymentType)}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                  </div>
                  {!p.salesReturnId && (
                    <IconButton icon={Trash2} tone="danger" title="Remove" requires="full" onClick={() => removePayment(p.id)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {remaining > 0 ? (
          <Can>
          <form onSubmit={addPayment} className="space-y-3 border-t border-black/10 pt-3">
            <span className="block text-xs font-semibold text-muted uppercase tracking-wide">Record a Payment</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  finishedGoods: FinishedGood[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(() => {
    // The returnable quantity follows the invoice line's own unit (else the product's).
    const byProduct = new Map<string, { maxQty: number; unit?: string }>();
    for (const it of invoice.items || []) {
      if (!it.finishedGoodId) continue;
      const prev = byProduct.get(it.finishedGoodId);
      byProduct.set(it.finishedGoodId, {
        maxQty: (prev?.maxQty || 0) + Number(it.quantity),
        unit: prev?.unit || it.unit || finishedGoods.find((f) => f.id === it.finishedGoodId)?.unit,
      });
    }
    return Array.from(byProduct.entries()).map(([finishedGoodId, { maxQty, unit }]) => ({
      finishedGoodId,
      maxQty,
      unit,
      quantity: '0',
    }));
  });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function productName(id: string) {
    return finishedGoods.find((f) => f.id === id)?.name || id;
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
          <div className="border border-black/10 rounded-lg overflow-x-auto">
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
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(it.maxQty, it.unit)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className={`${inputClass} text-right max-w-[6rem] sm:max-w-none`}
                        type="number"
                        step={quantityInputStep(it.unit)}
                        min="0"
                        max={Number(it.maxQty)}
                        value={it.quantity}
                        onChange={(e) => updateQty(i, e.target.value)}
                        onBlur={(e) => updateQty(i, String(Math.min(snapQuantityToUnit(Number(e.target.value) || 0, it.unit), Number(it.maxQty))))}
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
        <p className="text-xs text-muted">
          The return amount is worked out from this invoice: unit price, its share of the discount, and VAT. Stock and money
          move only when an Admin, CEO, MD or Accountant approves it.
        </p>
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

// Invoice list badge: delivery + stock status.
function DeliveryBadge({ invoice }: { invoice: Invoice }) {
  const base = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';
  if (invoice.deliveryStatus === 'delivered') return <span className={`${base} bg-brand-50 text-brand-700`}>Delivered</span>;
  if (invoice.waitingForStock) return <span className={`${base} bg-red-600 text-white`}>Waiting for stock</span>;
  if (invoice.stockReadyAt) return <span className={`${base} bg-emerald-100 text-emerald-700`}>Stock ready</span>;
  if (invoice.deliveryStatus === 'pending') return <span className={`${base} bg-amber-50 text-amber-700`}>Not delivered</span>;
  return null;
}

// Approve & add to stock: shows how the money settles before approving -
// first a credit on the invoice (lowers what the customer owes), the rest
// (only if they had already paid) refunded from the chosen account.
function ApproveSalesReturnModal({
  item,
  invoiceNumber,
  summary,
  bankAccounts,
  onClose,
  onSaved,
}: {
  item: SalesReturn;
  invoiceNumber: string;
  summary: string;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settlement, setSettlement] = useState<{
    total: number;
    outstanding: number;
    appliedToInvoice: number;
    refundAmount: number;
    refundAccountRequired: boolean;
  } | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/sales-returns/${item.id}/settlement`)
      .then((res) => setSettlement(res.data))
      .catch((err) => setError(err?.response?.data?.message || 'Could not load the amounts.'));
  }, [item.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/sales-returns/${item.id}/approve`, { bankAccountId: bankAccountId || undefined });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not approve this return.');
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: number, strong = false) => (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value.toFixed(3)} OMR</span>
    </div>
  );

  return (
    <Modal title={`Approve return — ${item.returnNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm">
          <div className="text-ink">{summary}</div>
          {invoiceNumber && <div className="text-xs text-muted">Invoice {invoiceNumber}</div>}
        </div>
        <div className="rounded-lg border border-black/10 p-3 text-sm space-y-1">
          {row('Return amount (after discount)', Number(item.subtotal))}
          {row('VAT', Number(item.vatAmount))}
          {row('Total', Number(item.total), true)}
        </div>
        {!settlement ? (
          !error && <div className="text-sm text-muted">Loading…</div>
        ) : (
          <div className="rounded-lg border border-black/10 p-3 text-sm space-y-1">
            {row('Still due on the invoice', settlement.outstanding)}
            {row('Credit note on the invoice', settlement.appliedToInvoice, true)}
            {row('Refund to customer', settlement.refundAmount, true)}
          </div>
        )}
        {settlement?.refundAccountRequired && (
          <Field label="Refund from account">
            <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
              <option value="">Choose bank / cash account</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({Number(a.currentBalance).toFixed(3)} OMR)
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="text-xs text-muted">The returned goods are added back to stock when you approve.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" requiresModule="approvals" disabled={busy || !settlement}>
            {busy ? 'Approving…' : 'Approve & add to stock'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
