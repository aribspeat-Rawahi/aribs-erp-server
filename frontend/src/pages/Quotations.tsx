import { useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Download, MessageCircle, Trash2, CheckCircle2, ArrowRightCircle } from 'lucide-react';
import api from '../api/client';
import { viewPdf, downloadPdf, openWhatsapp } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, IconButton, Card, EmptyState } from '../components/ui';
import { labelFor, DELIVERY_METHOD_OPTIONS } from '../constants';
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
interface Quotation {
  id: string;
  quotationNumber: string;
  customerId: string;
  status: string;
  total: number;
  validUntil?: string;
  deliveryMethod?: string;
  discountAmount?: number;
  items?: { finishedGoodId?: string; description: string; quantity: number; unitPrice: number }[];
}

const statusTone: Record<string, string> = {
  draft: 'bg-black/5 text-ink/70',
  approved: 'bg-brand-50 text-brand-700',
  converted: 'bg-blue-50 text-blue-700',
  expired: 'bg-red-50 text-red-600',
};

export default function Quotations() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin', 'accountant']);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);

  function load() {
    setLoading(true);
    api.get('/quotations').then((res) => setQuotations(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
  }, []);

  function customerName(id: string) {
    return customers.find((c) => c.id === id)?.name || id;
  }

  async function approve(id: string) {
    try {
      await api.post(`/quotations/${id}/approve`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not approve this quotation.');
    }
  }
  async function convert(id: string) {
    try {
      await api.post(`/quotations/${id}/convert-to-invoice`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not convert this quotation to an invoice.');
    }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this quotation? This cannot be undone.')) return;
    try {
      await api.delete(`/quotations/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this quotation.');
    }
  }

  // The list endpoint doesn't include line items — fetch the full
  // document (which does) before opening the edit form.
  async function startEdit(q: Quotation) {
    const res = await api.get(`/quotations/${q.id}`);
    setEditing(res.data);
  }

  const existing: ExistingDoc | undefined = editing
    ? {
        id: editing.id,
        items: editing.items,
        deliveryMethod: editing.deliveryMethod,
        discountAmount: editing.discountAmount,
        validUntil: editing.validUntil,
      }
    : undefined;

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Priced proposals sent to customers before an invoice is raised"
        action={<PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New quotation</PrimaryButton>}
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : quotations.length === 0 ? (
        <EmptyState>No quotations yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {quotations.map((q) => (
              <div key={q.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">{q.quotationNumber}</div>
                  <div className="text-xs text-muted">
                    {customerName(q.customerId)} · {labelFor(DELIVERY_METHOD_OPTIONS, q.deliveryMethod)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-ink">{Number(q.total).toFixed(3)} OMR</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[q.status] || 'bg-black/5 text-ink/70'}`}>
                      {q.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <IconButton icon={Eye} title="View PDF" onClick={() => viewPdf(`/quotations/${q.id}/pdf`)} />
                    <IconButton icon={Download} title="Download PDF" onClick={() => downloadPdf(`/quotations/${q.id}/pdf`, `${q.quotationNumber}.pdf`)} />
                    <IconButton icon={MessageCircle} title="Send on WhatsApp" onClick={() => openWhatsapp(`/quotations/${q.id}/whatsapp-link`)} />
                    {q.status !== 'converted' && (
                      <IconButton icon={Pencil} title="Edit" onClick={() => startEdit(q)} />
                    )}
                    {q.status === 'draft' && (
                      <IconButton icon={CheckCircle2} tone="success" title="Approve" onClick={() => approve(q.id)} />
                    )}
                    {q.status === 'approved' && (
                      <IconButton icon={ArrowRightCircle} tone="success" title="Convert to invoice" onClick={() => convert(q.id)} />
                    )}
                    {canDelete && (
                      <IconButton icon={Trash2} tone="danger" title="Delete" onClick={() => remove(q.id)} />
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
          docType="quotation"
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
          docType="quotation"
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
