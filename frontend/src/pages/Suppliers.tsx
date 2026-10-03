import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Check, Eye, Pencil, Plus, RotateCcw, Trash2, Wallet, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { labelFor, PAYMENT_TYPE_OPTIONS } from '../constants';
import {
  BankAccountEntry,
  BankDetailsFields,
  PartyDocumentEntry,
  DocumentsFields,
  emptyBankAccount,
  loadBankAccounts,
  loadPartyDocuments,
  saveBankAccounts,
  savePartyDocuments,
} from '../components/PartyBankDetails';
import { InteractionLogSection } from '../components/PartyInteractionLog';
import { formatQuantity, quantityInputStep, snapQuantityToUnit } from '../utils/formatQuantity';
import VendorPrepaymentsPanel from './VendorPrepaymentsPanel';
import VendorCreditsPanel from './VendorCreditsPanel';

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
}
interface RawMaterial {
  id: string;
  name: string;
  unit?: string;
}
interface ReorderItem {
  rawMaterialId: string;
  name: string;
  unit: string;
  quantityInStock: number | string;
  lowStockThreshold: number | string;
  costPerUnit: number | string;
  suggestedQuantity: number | string;
  isExplicitReorderQuantity: boolean;
}
interface ReorderGroup {
  supplierId: string | null;
  items: ReorderItem[];
}
interface PurchaseOrder {
  id: string;
  supplierId: string;
  status: string;
  notes?: string;
  createdAt: string;
  items: { rawMaterialId: string; quantity: number; costPerUnit: number }[];
  total?: number | string;
  paidAmount?: number | string;
  paymentStatus?: string;
}
interface SupplierPayment {
  id: string;
  amount: number | string;
  paymentType?: string;
  paymentDate: string;
  note?: string;
}
interface PurchaseOrderHistoryItem {
  id: string;
  status: string;
  createdAt: string;
  notes?: string;
  items: { rawMaterialId: string; quantity: number | string; costPerUnit: number | string }[];
}
interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}
interface PurchaseReturnItem {
  id: string;
  rawMaterialId: string;
  quantity: number | string;
  costPerUnit: number | string;
  vatRate: number | string;
}
interface PurchaseReturn {
  id: string;
  returnNumber: string;
  purchaseOrderId: string;
  supplierId: string;
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
  items: PurchaseReturnItem[];
}

// Matches PurchaseOrderStatus in the backend entity — 'ordered', not
// 'pending' (a mismatch here previously meant the tone/label and the
// Receive/Cancel buttons never showed for a freshly-created order).
const statusTone: Record<string, string> = {
  ordered: 'bg-amber-50 text-amber-700',
  received: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
};

const returnStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

type SuppliersTab = 'po' | 'suppliers' | 'reorder' | 'returns' | 'prepayments' | 'credits';
const VALID_SUPPLIERS_TABS: SuppliersTab[] = ['po', 'suppliers', 'reorder', 'returns', 'prepayments', 'credits'];

export default function Suppliers() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin']);
  const canDecide = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SuppliersTab) || 'po';
  const [tab, setTab] = useState<SuppliersTab>(VALID_SUPPLIERS_TABS.includes(initialTab) ? initialTab : 'po');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [reorderGroups, setReorderGroups] = useState<ReorderGroup[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showNewPo, setShowNewPo] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [returningOrder, setReturningOrder] = useState<PurchaseOrder | null>(null);
  const [payingOrder, setPayingOrder] = useState<PurchaseOrder | null>(null);
  const [rejectingReturn, setRejectingReturn] = useState<PurchaseReturn | null>(null);
  const [reorderDraft, setReorderDraft] = useState<{ supplierId: string; items: { rawMaterialId: string; quantity: string; costPerUnit: string }[] } | null>(null);

  function loadOrders() {
    setLoading(true);
    api.get('/purchase-orders').then((res) => setOrders(res.data)).finally(() => setLoading(false));
  }
  function loadSuppliers() {
    setLoading(true);
    api.get('/suppliers').then((res) => setSuppliers(res.data)).finally(() => setLoading(false));
  }
  function loadReorderSuggestions() {
    setLoading(true);
    api.get('/raw-materials/reorder-suggestions').then((res) => setReorderGroups(res.data.groups)).finally(() => setLoading(false));
  }
  function loadReturns() {
    setReturnsLoading(true);
    api.get('/purchase-returns').then((res) => setReturns(res.data)).finally(() => setReturnsLoading(false));
  }

  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data));
    api.get('/raw-materials').then((res) => setRawMaterials(res.data));
    api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
    // Fetched once up front (not just when the tab is opened) so the Pill
    // tab label can show an accurate count immediately.
    api.get('/raw-materials/reorder-suggestions').then((res) => setReorderGroups(res.data.groups));
  }, []);

  useEffect(() => {
    if (tab === 'po') loadOrders();
    else if (tab === 'suppliers') loadSuppliers();
    else if (tab === 'returns') loadReturns();
    else if (tab === 'reorder') loadReorderSuggestions();
  }, [tab]);

  function supplierName(id: string) {
    return suppliers.find((s) => s.id === id)?.name || id;
  }

  function dueOf(order: PurchaseOrder) {
    return Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0));
  }

  async function act(id: string, action: 'receive' | 'cancel') {
    try {
      await api.post(`/purchase-orders/${id}/${action}`);
      loadOrders();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not ${action} this purchase order.`);
    }
  }

  async function removeSupplier(id: string) {
    if (!window.confirm('Delete this supplier? This cannot be undone, and MD/CEO/GM will be notified by email.')) return;
    try {
      await api.delete(`/suppliers/${id}`);
      loadSuppliers();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this supplier.');
    }
  }

  async function removeOrder(id: string) {
    if (!window.confirm('Delete this purchase order? This cannot be undone.')) return;
    try {
      await api.delete(`/purchase-orders/${id}`);
      loadOrders();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this purchase order.');
    }
  }

  async function removeReturn(id: string) {
    if (!window.confirm('Delete this purchase return request? This cannot be undone.')) return;
    try {
      await api.delete(`/purchase-returns/${id}`);
      loadReturns();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this return.');
    }
  }

  async function approveReturn(id: string) {
    try {
      await api.post(`/purchase-returns/${id}/approve`);
      loadReturns();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not approve this return.');
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as any)}
          options={[
            { value: 'po', label: 'Purchase Orders' },
            { value: 'suppliers', label: 'Suppliers' },
            { value: 'reorder', label: reorderGroups.reduce((n, g) => n + g.items.length, 0) > 0 ? `Reorder Suggestions (${reorderGroups.reduce((n, g) => n + g.items.length, 0)})` : 'Reorder Suggestions' },
            { value: 'returns', label: 'Purchase Returns' },
            { value: 'prepayments', label: 'Vendor Prepayments' },
            { value: 'credits', label: 'Vendor Credits' },
          ]}
        />
      </div>

      {tab === 'po' ? (
        <>
          <PageHeader
            title="Purchase Orders"
            subtitle="Raw material purchases from your suppliers"
            action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNewPo(true)}>New purchase order</PrimaryButton>}
          />
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : orders.length === 0 ? (
            <EmptyState>No purchase orders yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{supplierName(o.supplierId)}</div>
                      <div className="text-xs text-muted">{o.items?.length || 0} item(s)</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
                        {o.status}
                      </span>
                      {o.status === 'ordered' && (
                        <>
                          <SecondaryButton requires="edit" onClick={() => act(o.id, 'receive')}>Receive</SecondaryButton>
                          <SecondaryButton requires="edit" onClick={() => act(o.id, 'cancel')}>Cancel</SecondaryButton>
                        </>
                      )}
                      {o.status === 'received' && (
                        <>
                          {dueOf(o) > 0.001 ? (
                            <SecondaryButton icon={Wallet} requires="edit" onClick={() => setPayingOrder(o)}>
                              Pay ({dueOf(o).toFixed(3)} due)
                            </SecondaryButton>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full font-medium bg-brand-50 text-brand-700">Paid</span>
                          )}
                          <SecondaryButton icon={RotateCcw} requires="edit" onClick={() => setReturningOrder(o)}>Return</SecondaryButton>
                        </>
                      )}
                      <div className="flex items-center gap-1.5">
                        <IconButton icon={Eye} title="View purchase order" onClick={() => setViewingOrder(o)} />
                        {o.status === 'ordered' && (
                          <>
                            <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditingOrder(o)} />
                            {canDelete && (
                              <IconButton icon={Trash2} tone="danger" title="Delete (Admin only)" requires="full" onClick={() => removeOrder(o.id)} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {showNewPo && (
            <NewPurchaseOrderModal
              suppliers={suppliers}
              rawMaterials={rawMaterials}
              onClose={() => setShowNewPo(false)}
              onSaved={() => {
                setShowNewPo(false);
                loadOrders();
              }}
            />
          )}
          {editingOrder && (
            <NewPurchaseOrderModal
              order={editingOrder}
              suppliers={suppliers}
              rawMaterials={rawMaterials}
              onClose={() => setEditingOrder(null)}
              onSaved={() => {
                setEditingOrder(null);
                loadOrders();
              }}
            />
          )}
          {viewingOrder && (
            <PurchaseOrderDetailModal
              order={viewingOrder}
              supplierName={supplierName(viewingOrder.supplierId)}
              rawMaterials={rawMaterials}
              onClose={() => setViewingOrder(null)}
            />
          )}
          {returningOrder && (
            <NewPurchaseReturnModal
              order={returningOrder}
              rawMaterials={rawMaterials}
              bankAccounts={bankAccounts}
              onClose={() => setReturningOrder(null)}
              onSaved={() => {
                setReturningOrder(null);
                loadOrders();
              }}
            />
          )}
          {payingOrder && (
            <PayBillModal
              order={payingOrder}
              supplierName={supplierName(payingOrder.supplierId)}
              bankAccounts={bankAccounts}
              onClose={() => setPayingOrder(null)}
              onChanged={loadOrders}
            />
          )}
        </>
      ) : tab === 'suppliers' ? (
        <>
          <PageHeader
            title="Suppliers"
            subtitle="Vendors you buy raw materials from"
            action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNewSupplier(true)}>New supplier</PrimaryButton>}
          />
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : suppliers.length === 0 ? (
            <EmptyState>No suppliers yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {suppliers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.phone || s.email || '-'}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <IconButton icon={Eye} title="View supplier data & history" onClick={() => setViewingSupplier(s)} />
                      <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditingSupplier(s)} />
                      {canDelete && (
                        <IconButton icon={Trash2} tone="danger" title="Delete (Admin only)" requires="full" onClick={() => removeSupplier(s.id)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {showNewSupplier && (
            <SupplierModal
              onClose={() => setShowNewSupplier(false)}
              onSaved={() => {
                setShowNewSupplier(false);
                loadSuppliers();
              }}
            />
          )}
          {editingSupplier && (
            <SupplierModal
              supplier={editingSupplier}
              onClose={() => setEditingSupplier(null)}
              onSaved={() => {
                setEditingSupplier(null);
                loadSuppliers();
              }}
            />
          )}
          {viewingSupplier && (
            <SupplierDetailModal
              supplier={viewingSupplier}
              rawMaterials={rawMaterials}
              onClose={() => setViewingSupplier(null)}
            />
          )}
        </>
      ) : tab === 'returns' ? (
        <>
          <PageHeader
            title="Purchase Returns"
            subtitle="Items returned to suppliers, with pending/approved/rejected status"
          />
          {returnsLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : returns.length === 0 ? (
            <EmptyState>No purchase returns yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">{supplierName(r.supplierId)}</div>
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
            <RejectPurchaseReturnModal
              item={rejectingReturn}
              onClose={() => setRejectingReturn(null)}
              onSaved={() => {
                setRejectingReturn(null);
                loadReturns();
              }}
            />
          )}
        </>
      ) : tab === 'prepayments' ? (
        <>
          <PageHeader
            title="Vendor Prepayments"
            subtitle="Advances paid to suppliers ahead of a bill, applied against Accounts Payable as bills come in"
          />
          <VendorPrepaymentsPanel suppliers={suppliers} bankAccounts={bankAccounts} />
        </>
      ) : tab === 'credits' ? (
        <>
          <PageHeader
            title="Vendor Credits"
            subtitle="Credit notes from suppliers not tied to a Purchase Return — goodwill credits, price adjustments, rebates"
          />
          <VendorCreditsPanel suppliers={suppliers} bankAccounts={bankAccounts} />
        </>
      ) : (
        <>
          <PageHeader
            title="Reorder Suggestions"
            subtitle="Raw materials at or below their low-stock threshold, grouped by supplier"
          />
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : reorderGroups.length === 0 || reorderGroups.every((g) => g.items.length === 0) ? (
            <EmptyState>Nothing needs reordering right now.</EmptyState>
          ) : (
            <div className="space-y-4">
              {reorderGroups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <Card key={g.supplierId || 'unassigned'}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
                      <div className="text-sm font-semibold text-ink">
                        {g.supplierId ? supplierName(g.supplierId) : 'No preferred supplier set'}
                      </div>
                      <PrimaryButton
                        icon={Plus}
                        requires="edit"
                        onClick={() =>
                          setReorderDraft({
                            supplierId: g.supplierId || suppliers[0]?.id || '',
                            items: g.items.map((it) => ({
                              rawMaterialId: it.rawMaterialId,
                              quantity: String(it.suggestedQuantity),
                              costPerUnit: String(it.costPerUnit),
                            })),
                          })
                        }
                      >
                        Create purchase order
                      </PrimaryButton>
                    </div>
                    <div className="divide-y divide-black/5">
                      {g.items.map((it) => (
                        <div key={it.rawMaterialId} className="flex items-center justify-between px-4 py-2.5">
                          <div className="text-sm text-ink">{it.name}</div>
                          <div className="text-xs text-muted text-right">
                            <div>
                              {formatQuantity(it.quantityInStock, it.unit)} {it.unit} in stock (alert at {formatQuantity(it.lowStockThreshold, it.unit)})
                            </div>
                            <div className="text-amber-700 font-medium">
                              Suggested: {formatQuantity(it.suggestedQuantity, it.unit)} {it.unit}
                              {!it.isExplicitReorderQuantity && ' (estimated — set a Reorder Quantity on this item for a precise suggestion)'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
            </div>
          )}
          {reorderDraft && (
            <NewPurchaseOrderModal
              initial={reorderDraft}
              suppliers={suppliers}
              rawMaterials={rawMaterials}
              onClose={() => setReorderDraft(null)}
              onSaved={() => {
                setReorderDraft(null);
                loadReorderSuggestions();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// Shows the supplier's own data plus every purchase order placed with
// them — same idea as CustomerDetailModal, minus the PDF viewer (purchase
// orders don't have a printable PDF the way invoices/quotations do).
function SupplierDetailModal({
  supplier,
  rawMaterials,
  onClose,
}: {
  supplier: Supplier;
  rawMaterials: RawMaterial[];
  onClose: () => void;
}) {
  const [history, setHistory] = useState<{ purchaseOrders: PurchaseOrderHistoryItem[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/suppliers/${supplier.id}/history`)
      .then((res) => setHistory(res.data))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  function materialName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
  }

  function orderTotal(order: PurchaseOrderHistoryItem) {
    return order.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.costPerUnit), 0);
  }

  return (
    <Modal title={`Supplier: ${supplier.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><span className="text-muted">Contact person:</span> {supplier.contactPerson || '-'}</div>
          <div><span className="text-muted">Phone:</span> {supplier.phone || '-'}</div>
          <div><span className="text-muted">Email:</span> {supplier.email || '-'}</div>
          <div><span className="text-muted">Address:</span> {supplier.address || '-'}</div>
        </div>

        <InteractionLogSection basePath={`/suppliers/${supplier.id}`} />

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Purchase Orders ({history?.purchaseOrders.length ?? 0})
          </h3>
          {loading ? (
            <p className="text-sm text-muted">Loading history…</p>
          ) : !history || history.purchaseOrders.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
              {history.purchaseOrders.map((o) => (
                <div key={o.id} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
                        {o.status}
                      </span>
                      <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-sm font-medium text-ink">{orderTotal(o).toFixed(3)} OMR</div>
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {o.items.map((it) => `${materialName(it.rawMaterialId)} × ${Number(it.quantity)}`).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier?: Supplier;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(supplier?.name || '');
  const [contactPerson, setContactPerson] = useState(supplier?.contactPerson || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [email, setEmail] = useState(supplier?.email || '');
  const [address, setAddress] = useState(supplier?.address || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // "Bank Details" and "Documents" — same collapsible pattern as the
  // Customer entry form (see PartyBankDetails.tsx for the shared pieces).
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountEntry[]>([]);
  const [showDocuments, setShowDocuments] = useState(false);
  const [documents, setDocuments] = useState<PartyDocumentEntry[]>([]);
  const basePath = supplier ? `/suppliers/${supplier.id}` : undefined;

  useEffect(() => {
    if (showBankDetails && supplier && bankAccounts.length === 0) {
      loadBankAccounts(`/suppliers/${supplier.id}`).then((rows) =>
        setBankAccounts(rows.length > 0 ? rows : [emptyBankAccount()]),
      );
    } else if (showBankDetails && bankAccounts.length === 0) {
      setBankAccounts([emptyBankAccount()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBankDetails]);

  useEffect(() => {
    if (showDocuments && supplier && documents.length === 0) {
      loadPartyDocuments(`/suppliers/${supplier.id}`).then((rows) => setDocuments(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDocuments]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      name,
      contactPerson: contactPerson || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
    };
    try {
      let supplierId = supplier?.id;
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, payload);
      else {
        const res = await api.post('/suppliers', payload);
        supplierId = res.data.id;
      }
      // Bank accounts/documents are saved as a separate step since they
      // need the supplier's id, which only exists once created above.
      if (supplierId) {
        await saveBankAccounts(`/suppliers/${supplierId}`, bankAccounts);
        await savePartyDocuments(`/suppliers/${supplierId}`, documents);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={supplier ? 'Edit supplier' : 'New supplier'} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Contact person">
          <input className={inputClass} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Address">
          <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-2 pt-1">
          <SecondaryButton
            icon={ChevronDown}
            onClick={() => setShowBankDetails((v) => !v)}
            className={showBankDetails ? '[&>svg]:rotate-180' : ''}
          >
            Bank Details
          </SecondaryButton>
          <SecondaryButton
            icon={ChevronDown}
            onClick={() => setShowDocuments((v) => !v)}
            className={showDocuments ? '[&>svg]:rotate-180' : ''}
          >
            Documents
          </SecondaryButton>
        </div>
        {showBankDetails && (
          <div className="border-t border-black/10 pt-3">
            <BankDetailsFields entries={bankAccounts} onChange={setBankAccounts} basePath={basePath} />
          </div>
        )}
        {showDocuments && (
          <div className="border-t border-black/10 pt-3">
            <DocumentsFields entries={documents} onChange={setDocuments} basePath={basePath} />
          </div>
        )}

        {supplier && (
          <div className="border-t border-black/10 pt-3">
            <InteractionLogSection basePath={`/suppliers/${supplier.id}`} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Read-only view of a purchase order — supplier, status, notes, and the
// full item list with per-line and grand totals.
function PurchaseOrderDetailModal({
  order,
  supplierName,
  rawMaterials,
  onClose,
}: {
  order: PurchaseOrder;
  supplierName: string;
  rawMaterials: RawMaterial[];
  onClose: () => void;
}) {
  function materialName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
  }
  function materialUnit(id: string) {
    return rawMaterials.find((r) => r.id === id)?.unit;
  }
  const total = order.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.costPerUnit), 0);

  return (
    <Modal title={`Purchase order: ${supplierName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><span className="text-muted">Status:</span> <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[order.status] || 'bg-black/5 text-ink/70'}`}>{order.status}</span></div>
          <div><span className="text-muted">Date:</span> {new Date(order.createdAt).toLocaleDateString()}</div>
          {order.notes && <div className="col-span-2"><span className="text-muted">Notes:</span> {order.notes}</div>}
        </div>
        <div className="border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-xs text-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Cost/unit</th>
                <th className="text-right px-3 py-2">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {order.items.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{materialName(it.rawMaterialId)}</td>
                  <td className="px-3 py-2 text-right">{formatQuantity(it.quantity, materialUnit(it.rawMaterialId))}</td>
                  <td className="px-3 py-2 text-right">{Number(it.costPerUnit).toFixed(3)}</td>
                  <td className="px-3 py-2 text-right">{(Number(it.quantity) * Number(it.costPerUnit)).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/10 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right">Total</td>
                <td className="px-3 py-2 text-right">{total.toFixed(3)} OMR</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Pay Bills — mirrors Invoices.tsx's PaymentLedgerModal (Dr 2000 Accounts
// Payable / Cr the chosen bank account, auto-posted server-side), with an
// explicit "Pay from account" select since a supplier payment without a
// real bank account behind it wouldn't accomplish anything the "Return"
// flow doesn't already cover.
function PayBillModal({
  order,
  supplierName,
  bankAccounts,
  onClose,
  onChanged,
}: {
  order: PurchaseOrder;
  supplierName: string;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(Number(order.total || 0));
  const [paidAmount, setPaidAmount] = useState(Number(order.paidAmount || 0));

  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('bank_transfer');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get(`/purchase-orders/${order.id}/payments`)
      .then((res) => setPayments(res.data))
      .finally(() => setLoading(false));
    api.get(`/purchase-orders/${order.id}`).then((res) => {
      setTotal(Number(res.data.total || 0));
      setPaidAmount(Number(res.data.paidAmount || 0));
    });
  }

  useEffect(load, [order.id]);

  const remaining = Math.max(0, total - paidAmount);

  async function addPayment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/purchase-orders/${order.id}/payments`, {
        amount: Number(amount),
        paymentType,
        paymentDate,
        note: note || undefined,
        bankAccountId: bankAccountId || undefined,
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
    await api.delete(`/purchase-orders/${order.id}/payments/${id}`);
    load();
    onChanged();
  }

  return (
    <Modal title={`Pay bill — ${supplierName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Order Total</div>
            <div className="font-semibold text-ink">{total.toFixed(3)} OMR</div>
          </div>
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Paid So Far</div>
            <div className="font-semibold text-brand-700">{paidAmount.toFixed(3)} OMR</div>
          </div>
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Remaining Due</div>
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
              <Field label="Pay from account">
                <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  <option value="">— Record only (no bank movement) —</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({Number(a.currentBalance).toFixed(3)} OMR)
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Note (optional)">
              <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cheque number" />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Recording…' : 'Record Payment'}</PrimaryButton>
            </div>
          </form>
        ) : (
          <p className="text-sm text-brand-700 border-t border-black/10 pt-3">This bill is fully paid.</p>
        )}

        <div className="flex justify-end pt-1">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

function NewPurchaseOrderModal({
  order,
  initial,
  suppliers,
  rawMaterials,
  onClose,
  onSaved,
}: {
  order?: PurchaseOrder;
  // Prefill-on-create source (Inventory Reorder Automation — "Create purchase
  // order" from a Reorder Suggestions group). Unlike `order`, this never
  // triggers a PATCH — the form still POSTs a brand-new purchase order.
  initial?: { supplierId: string; items: { rawMaterialId: string; quantity: string; costPerUnit: string }[] };
  suppliers: Supplier[];
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState(order?.supplierId || initial?.supplierId || suppliers[0]?.id || '');
  const [notes, setNotes] = useState(order?.notes || '');
  const [items, setItems] = useState(
    order && order.items.length > 0
      ? order.items.map((it) => ({ _key: newItemKey(), rawMaterialId: it.rawMaterialId, quantity: String(it.quantity), costPerUnit: String(it.costPerUnit) }))
      : initial && initial.items.length > 0
      ? initial.items.map((it) => ({ _key: newItemKey(), rawMaterialId: it.rawMaterialId, quantity: it.quantity, costPerUnit: it.costPerUnit }))
      : [{ _key: newItemKey(), rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', costPerUnit: '0' }],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateItem(i: number, patch: Partial<{ rawMaterialId: string; quantity: string; costPerUnit: string }>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      supplierId,
      notes: notes || undefined,
      items: items.map((it) => ({
        rawMaterialId: it.rawMaterialId,
        quantity: Number(it.quantity),
        costPerUnit: Number(it.costPerUnit),
      })),
    };
    try {
      if (order) await api.patch(`/purchase-orders/${order.id}`, payload);
      else await api.post('/purchase-orders', payload);
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || `Could not ${order ? 'update' : 'create'} the order.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={order ? 'Edit purchase order' : 'New purchase order'} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Supplier">
          <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={item._key} className="grid grid-cols-[1fr_100px_120px] gap-2">
              <select className={inputClass} value={item.rawMaterialId} onChange={(e) => updateItem(i, { rawMaterialId: e.target.value })}>
                {rawMaterials.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                type="number"
                step={quantityInputStep(rawMaterials.find((r) => r.id === item.rawMaterialId)?.unit)}
                min={quantityInputStep(rawMaterials.find((r) => r.id === item.rawMaterialId)?.unit)}
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateItem(i, { quantity: e.target.value })}
                onBlur={(e) =>
                  updateItem(i, {
                    quantity: String(snapQuantityToUnit(Number(e.target.value) || 0, rawMaterials.find((r) => r.id === item.rawMaterialId)?.unit)),
                  })
                }
              />
              <input className={inputClass} type="number" step="0.001" min="0" placeholder="Cost/unit" value={item.costPerUnit} onChange={(e) => updateItem(i, { costPerUnit: e.target.value })} />
            </div>
          ))}
          <SecondaryButton onClick={() => setItems((prev) => [...prev, { _key: newItemKey(), rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', costPerUnit: '0' }])}>
            + Add item
          </SecondaryButton>
        </div>
        <Field label="Notes (optional)">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : order ? 'Save' : 'Create'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Picks which received items (and how much) to send back to the
// supplier. Only rawMaterialId + quantity go to the backend — cost/VAT
// are always copied server-side from the original purchase order item,
// so this stays a simple quantity picker and the backend is the single
// source of truth for money. "Ordered qty" is shown only as a hint —
// the real returnable cap (accounting for earlier approved returns) is
// enforced by the API and surfaced here as an error if exceeded.
function NewPurchaseReturnModal({
  order,
  rawMaterials,
  bankAccounts,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder;
  rawMaterials: RawMaterial[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(
    order.items.map((it) => ({ rawMaterialId: it.rawMaterialId, maxQty: it.quantity, quantity: '0' })),
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function materialName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
  }
  function materialUnit(id: string) {
    return rawMaterials.find((r) => r.id === id)?.unit;
  }

  function updateQty(i: number, quantity: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, quantity } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const lines = items
      .filter((it) => Number(it.quantity) > 0)
      .map((it) => ({ rawMaterialId: it.rawMaterialId, quantity: Number(it.quantity) }));
    if (lines.length === 0) {
      setError('Enter a return quantity for at least one item.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/purchase-returns', {
        purchaseOrderId: order.id,
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
    <Modal title="Return items to supplier" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-xs text-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Ordered qty</th>
                <th className="text-right px-3 py-2">Return qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {items.map((it, i) => (
                <tr key={it.rawMaterialId}>
                  <td className="px-3 py-2">{materialName(it.rawMaterialId)}</td>
                  <td className="px-3 py-2 text-right">{formatQuantity(it.maxQty, materialUnit(it.rawMaterialId))}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className={`${inputClass} text-right`}
                      type="number"
                      step={quantityInputStep(materialUnit(it.rawMaterialId))}
                      min="0"
                      max={Number(it.maxQty)}
                      value={it.quantity}
                      onChange={(e) => updateQty(i, e.target.value)}
                      onBlur={(e) => updateQty(i, String(snapQuantityToUnit(Number(e.target.value) || 0, materialUnit(it.rawMaterialId))))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Reason (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Refund into account (optional — auto-deposits on approval)">
          <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">— Credit against Accounts Payable only —</option>
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
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Submit return'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RejectPurchaseReturnModal({
  item,
  onClose,
  onSaved,
}: {
  item: PurchaseReturn;
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
      await api.post(`/purchase-returns/${item.id}/reject`, { reason });
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
