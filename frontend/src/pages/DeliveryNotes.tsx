import { useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Download, MessageCircle, Share2, Trash2, PackageCheck } from 'lucide-react';
import api from '../api/client';
import { viewPdf, downloadPdf, openWhatsapp, sharePdf } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, IconButton, Card, EmptyState } from '../components/ui';
import { labelFor, PAYMENT_TYPE_OPTIONS, DELIVERY_METHOD_OPTIONS } from '../constants';
import NewDocumentModal, { ExistingDoc } from '../components/NewDocumentModal';

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
  items?: { finishedGoodId?: string; description: string; quantity: number; unitPrice: number }[];
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

  function load() {
    setLoading(true);
    api.get('/delivery-notes').then((res) => setNotes(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  async function markDelivered(id: string) {
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
      {loading ? (
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
