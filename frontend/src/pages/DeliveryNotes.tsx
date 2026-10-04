import { useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Download, MessageCircle, Share2, Trash2, PackageCheck } from 'lucide-react';
import api from '../api/client';
import { viewPdf, downloadPdf, openWhatsapp, sharePdf } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, IconButton, Card, EmptyState, Pill } from '../components/ui';
import { labelFor, PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS } from '../constants';
import NewDocumentModal, { ExistingDoc } from '../components/NewDocumentModal';
import { formatQuantityWithUnit } from '../utils/formatQuantity';

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
interface DeliveryNote {
  id: string;
  deliveryNoteNumber: string;
  customerId: string;
  status: string;
  total: number;
  paymentType?: string;
  deliveryMethod?: string;
  discountAmount?: number;
  deliveryDate?: string;
  items?: { finishedGoodId?: string; description: string; quantity: number; unit?: string; unitPrice: number }[];
}

// One row of "Not Delivered Yet" (GET /delivery-notes/pending): an invoice
// with no delivery note, or a delivery note not delivered yet.
interface PendingRow {
  type: 'invoice' | 'delivery_note';
  id: string;
  number: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerName: string;
  issueDate: string;
  deliveryDate: string | null;
  deliveryMethod: string | null;
  items: { description: string; quantity: number; unit: string }[];
  waitingForStock: boolean;
  shortages: { name: string; unit: string; short: number }[];
  stockReadyAt: string | null;
}

const statusTone: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700',
  delivered: 'bg-brand-50 text-brand-700',
};

export default function DeliveryNotes() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin', 'accountant']);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<DeliveryNote | null>(null);
  const [tab, setTab] = useState<'all' | 'pending'>('all');
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get('/delivery-notes').then((res) => setNotes(res.data)).finally(() => setLoading(false));
    loadPending();
  }
  function loadPending() {
    setPendingLoading(true);
    api.get('/delivery-notes/pending').then((res) => setPending(res.data)).finally(() => setPendingLoading(false));
  }
  const waitingCount = pending.filter((r) => r.waitingForStock).length;

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  async function markInvoiceDelivered(row: PendingRow) {
    if (row.waitingForStock && !window.confirm(`${row.number} is still waiting for stock. Mark it delivered anyway?`)) return;
    try {
      await api.post(`/delivery-notes/pending/invoices/${row.id}/mark-delivered`);
      loadPending();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not mark this invoice as delivered.');
    }
  }

  async function markDelivered(id: string, waitingForStock = false) {
    if (waitingForStock && !window.confirm('This delivery is still waiting for stock. Mark it delivered anyway?')) return;
    try {
      await api.post(`/delivery-notes/${id}/mark-delivered`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not mark this delivery note as delivered.');
    }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this delivery note? This cannot be undone.')) return;
    try {
      await api.delete(`/delivery-notes/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this delivery note.');
    }
  }

  // The list endpoint doesn't include line items — fetch the full
  // document (which does) before opening the edit form.
  async function startEdit(n: DeliveryNote) {
    const res = await api.get(`/delivery-notes/${n.id}`);
    setEditing(res.data);
  }

  const existing: ExistingDoc | undefined = editing
    ? {
        id: editing.id,
        items: editing.items,
        paymentType: editing.paymentType,
        deliveryMethod: editing.deliveryMethod,
        discountAmount: editing.discountAmount,
        deliveryDate: editing.deliveryDate,
      }
    : undefined;

  return (
    <div>
      <PageHeader
        title="Delivery Notes"
        subtitle="What physically went out to the customer"
        action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNew(true)}>New delivery note</PrimaryButton>}
      />
      <div className="mb-4 flex items-center gap-2">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as 'all' | 'pending')}
          options={[
            { value: 'all', label: 'All Delivery Notes' },
            { value: 'pending', label: `Not Delivered Yet${pending.length ? ` (${pending.length})` : ''}` },
          ]}
        />
        {waitingCount > 0 && (
          <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white" title="Waiting for stock">
            {waitingCount} waiting for stock
          </span>
        )}
      </div>
      {tab === 'pending' ? (
        pendingLoading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : pending.length === 0 ? (
          <EmptyState>Everything has been delivered.</EmptyState>
        ) : (
          <Card>
            <div className="divide-y divide-black/5">
              {pending.map((r) => {
                const pdfPath = r.type === 'invoice' ? `/invoices/${r.id}/pdf` : `/delivery-notes/${r.id}/pdf`;
                return (
                  <div key={r.type + r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-ink whitespace-nowrap">{r.number}</span>
                        {r.type === 'delivery_note' && r.invoiceNumber && (
                          <span className="text-xs text-muted whitespace-nowrap">Invoice {r.invoiceNumber}</span>
                        )}
                        {r.waitingForStock ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-600 text-white whitespace-nowrap">Waiting for stock</span>
                        ) : r.stockReadyAt ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 whitespace-nowrap">Stock ready</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted">
                        {r.customerName} · Issued {r.issueDate}
                        {r.deliveryDate ? ` · Delivery ${r.deliveryDate}` : ' · No delivery date'}
                      </div>
                      <div className="text-xs text-ink/80 break-words">
                        {r.items.map((it) => `${it.description} × ${formatQuantityWithUnit(it.quantity, it.unit)}`).join(', ')}
                      </div>
                      {r.waitingForStock && (
                        <div className="text-xs text-red-600 break-words">
                          Short: {r.shortages.map((s) => `${s.name} ${formatQuantityWithUnit(s.short, s.unit)}`).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IconButton icon={Eye} title="View PDF" onClick={() => viewPdf(pdfPath)} />
                      <IconButton icon={Download} title="Download PDF" onClick={() => downloadPdf(pdfPath, `${r.number}.pdf`)} />
                      <IconButton
                        icon={PackageCheck}
                        tone="success"
                        title="Mark delivered"
                        requires="edit"
                        onClick={() => (r.type === 'invoice' ? markInvoiceDelivered(r) : markDelivered(r.id, r.waitingForStock))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )
      ) : loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : notes.length === 0 ? (
        <EmptyState>No delivery notes yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {notes.map((n) => (
              <div key={n.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink whitespace-nowrap">{n.deliveryNoteNumber}</div>
                  <div className="text-xs text-muted">
                    {customerName(n.customerId)} · {labelFor(PAYMENT_TYPE_OPTIONS, n.paymentType)} · {labelFor(DELIVERY_METHOD_OPTIONS, n.deliveryMethod)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
                  <div className="sm:text-right">
                    <div className="text-sm font-semibold text-ink">{Number(n.total).toFixed(3)} OMR</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[n.status] || 'bg-black/5 text-ink/70'}`}>
                      {n.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <IconButton icon={Eye} title="View PDF" onClick={() => viewPdf(`/delivery-notes/${n.id}/pdf`)} />
                    <IconButton icon={Download} title="Download PDF" onClick={() => downloadPdf(`/delivery-notes/${n.id}/pdf`, `${n.deliveryNoteNumber}.pdf`)} />
                    <IconButton icon={MessageCircle} title="Send on WhatsApp" onClick={() => openWhatsapp(`/delivery-notes/${n.id}/whatsapp-link`)} />
                    <IconButton icon={Share2} title="Share PDF (attach the file)" onClick={() => sharePdf(`/delivery-notes/${n.id}/pdf`, `${n.deliveryNoteNumber}.pdf`, `Delivery Note ${n.deliveryNoteNumber}`)} />
                    <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => startEdit(n)} />
                    {n.status === 'draft' && (
                      <IconButton icon={PackageCheck} tone="success" title="Mark delivered" requires="edit" onClick={() => markDelivered(n.id)} />
                    )}
                    {canDelete && (
                      <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => remove(n.id)} />
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
          docType="delivery_note"
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
          docType="delivery_note"
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
    </div>
  );
}
