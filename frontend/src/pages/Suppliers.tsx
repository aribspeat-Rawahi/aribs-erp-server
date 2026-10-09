import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Check, Download, Eye, PackageCheck, Pencil, Plus, RotateCcw, Trash2, Upload, Wallet, X } from 'lucide-react';
import { viewPdf, downloadPdf } from '../api/docActions';
import ImportModal from '../components/ImportModal';
import BankAccountSelect from '../components/BankAccountSelect';
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
import {
  formatQuantityWithUnit,
  normalizeUnit,
  quantityInputMin,
  quantityInputStep,
  quantityInputValue,
  snapQuantityToUnit,
  unitLabel,
} from '../utils/formatQuantity';
import VendorPrepaymentsPanel from './VendorPrepaymentsPanel';
import VendorCreditsPanel from './VendorCreditsPanel';
import { localISODate } from '../utils/dates';

interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  vatin?: string | null;
  vatStatus?: 'registered' | 'not_registered' | 'foreign';
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
interface PurchaseOrderLine {
  id?: string;
  rawMaterialId: string;
  quantity: number | string;
  costPerUnit: number | string;
  unit?: string;
  vatRate?: number | string;
  receivedQuantity?: number | string;
}
interface GoodsReceipt {
  id: string;
  grnNumber: string;
  receivedDate: string;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  subtotal: number | string;
  vatAmount: number | string;
  total: number | string;
  note?: string | null;
  items?: { rawMaterialId: string; quantity: number | string; unit?: string }[];
}
interface PurchaseOrder {
  id: string;
  poNumber?: string;
  supplierId: string;
  status: string;
  notes?: string;
  createdAt: string;
  expectedDate?: string | null;
  // `unit` is copied from the raw material onto each line by the backend.
  items: PurchaseOrderLine[];
  subtotal?: number | string;
  vatAmount?: number | string;
  total?: number | string;
  // what has actually arrived - this is what is owed to the supplier
  receivedTotal?: number | string;
  closedShort?: boolean;
  paidAmount?: number | string;
  paymentStatus?: string;
  goodsReceipts?: GoodsReceipt[];
  overdue?: boolean;
  // unpaid supplier bill from the old books (Opening Balances)
  isOpening?: boolean;
  openingReference?: string | null;
  dueDate?: string | null;
}
interface SupplierPayment {
  id: string;
  amount: number | string;
  paymentType?: string;
  paymentDate: string;
  note?: string;
  // set = a credit (debit note / vendor credit / prepayment), not money paid
  creditSource?: string | null;
}
interface PurchaseOrderHistoryItem {
  id: string;
  status: string;
  createdAt: string;
  notes?: string;
  items: { rawMaterialId: string; quantity: number | string; costPerUnit: number | string; unit?: string }[];
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
  unit?: string;
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
  appliedToOrder?: number | string;
  refundAmount?: number | string;
  items: PurchaseReturnItem[];
}

// Matches PurchaseOrderStatus in the backend entity — 'ordered', not
// 'pending' (a mismatch here previously meant the tone/label and the
// Receive/Cancel buttons never showed for a freshly-created order).
const statusTone: Record<string, string> = {
  ordered: 'bg-amber-50 text-amber-700',
  partially_received: 'bg-sky-50 text-sky-700',
  received: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
};
const statusLabel: Record<string, string> = {
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};
const returnStatusLabel: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved — taken out of stock',
  rejected: 'Rejected',
};
const VAT_STATUS_OPTIONS = [
  { value: 'registered', label: 'Oman VAT registered (5% VAT)' },
  { value: 'not_registered', label: 'Not VAT registered (no VAT)' },
  { value: 'foreign', label: 'Foreign supplier / import (no VAT on its invoice)' },
];
const CREDIT_SOURCE_LABEL: Record<string, string> = {
  debit_note: 'Debit note (purchase return)',
  vendor_credit: 'Vendor credit applied',
  vendor_prepayment: 'Prepayment applied',
};
function poRef(o: { poNumber?: string; id: string; openingReference?: string | null }) {
  const n = o.poNumber || `PO ${o.id.slice(0, 8)}`;
  return o.openingReference ? `${n} (bill ${o.openingReference})` : n;
}

const returnStatusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-brand-50 text-brand-700',
  rejected: 'bg-red-50 text-red-600',
};

function newItemKey() {
  return Math.random().toString(36).slice(2);
}

type SuppliersTab = 'po' | 'pending' | 'suppliers' | 'reorder' | 'returns' | 'prepayments' | 'credits';
const VALID_SUPPLIERS_TABS: SuppliersTab[] = ['po', 'pending', 'suppliers', 'reorder', 'returns', 'prepayments', 'credits'];

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
  const [showImport, setShowImport] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [returningOrder, setReturningOrder] = useState<PurchaseOrder | null>(null);
  const [payingOrder, setPayingOrder] = useState<PurchaseOrder | null>(null);
  const [rejectingReturn, setRejectingReturn] = useState<PurchaseReturn | null>(null);
  const [approvingReturn, setApprovingReturn] = useState<PurchaseReturn | null>(null);
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PurchaseOrder[]>([]);
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
  function loadPending() {
    api.get('/purchase-orders/pending-receipts').then((res) => setPendingOrders(res.data)).catch(() => undefined);
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
    loadPending();
  }, []);

  useEffect(() => {
    if (tab === 'po') loadOrders();
    else if (tab === 'pending') loadPending();
    else if (tab === 'suppliers') loadSuppliers();
    else if (tab === 'returns') {
      loadReturns();
      loadOrders();
    }
    else if (tab === 'reorder') loadReorderSuggestions();
  }, [tab]);

  function supplierName(id: string) {
    return suppliers.find((s) => s.id === id)?.name || id;
  }

  function materialName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
  }
  function materialUnit(id: string) {
    return rawMaterials.find((r) => r.id === id)?.unit;
  }

  // owed = value of what has arrived (not the ordered total)
  function dueOf(order: PurchaseOrder) {
    return Math.max(0, Number(order.receivedTotal || 0) - Number(order.paidAmount || 0));
  }

  function refreshOrders() {
    loadOrders();
    loadPending();
  }

  async function act(id: string, action: 'cancel' | 'close') {
    const question =
      action === 'close'
        ? 'Close this order? The rest will not be received. You owe only for what has arrived.'
        : 'Cancel this purchase order?';
    if (!window.confirm(question)) return;
    try {
      await api.post(`/purchase-orders/${id}/${action}`);
      refreshOrders();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not ${action} this purchase order.`);
    }
  }

  async function openReceive(o: PurchaseOrder) {
    const res = await api.get(`/purchase-orders/${o.id}`);
    setReceivingOrder(res.data);
  }
  async function openReturn(o: PurchaseOrder) {
    const res = await api.get(`/purchase-orders/${o.id}`);
    setReturningOrder(res.data);
  }
  async function openOrder(o: PurchaseOrder) {
    const res = await api.get(`/purchase-orders/${o.id}`);
    setViewingOrder(res.data);
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

  function orderNumber(id: string) {
    const o = orders.find((x) => x.id === id) || pendingOrders.find((x) => x.id === id);
    return o ? poRef(o) : '';
  }
  const overdueCount = pendingOrders.filter((o) => o.overdue).length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as any)}
          options={[
            { value: 'po', label: 'Purchase Orders' },
            { value: 'pending', label: pendingOrders.length ? `Not Received Yet (${pendingOrders.length})` : 'Not Received Yet' },
            { value: 'suppliers', label: 'Suppliers' },
            { value: 'reorder', label: reorderGroups.reduce((n, g) => n + g.items.length, 0) > 0 ? `Reorder Suggestions (${reorderGroups.reduce((n, g) => n + g.items.length, 0)})` : 'Reorder Suggestions' },
            { value: 'returns', label: 'Purchase Returns' },
            { value: 'prepayments', label: 'Vendor Prepayments' },
            { value: 'credits', label: 'Vendor Credits' },
          ]}
        />
        {overdueCount > 0 && (
          <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white" title="Purchase orders past their expected date">
            {overdueCount} overdue
          </span>
        )}
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
                  <PurchaseOrderRow
                    key={o.id}
                    order={o}
                    supplierName={supplierName(o.supplierId)}
                    due={dueOf(o)}
                    canDelete={canDelete}
                    onView={() => openOrder(o)}
                    onReceive={() => openReceive(o)}
                    onCancel={() => act(o.id, 'cancel')}
                    onClose={() => act(o.id, 'close')}
                    onPay={() => setPayingOrder(o)}
                    onReturn={() => openReturn(o)}
                    onEdit={() => setEditingOrder(o)}
                    onDelete={() => removeOrder(o.id)}
                  />
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
                refreshOrders();
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
          {receivingOrder && (
            <ReceiveGoodsModal
              order={receivingOrder}
              supplierName={supplierName(receivingOrder.supplierId)}
              rawMaterials={rawMaterials}
              onClose={() => setReceivingOrder(null)}
              onSaved={() => {
                setReceivingOrder(null);
                refreshOrders();
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
              onChanged={refreshOrders}
            />
          )}
        </>
      ) : tab === 'pending' ? (
        <>
          <PageHeader title="Not Received Yet" subtitle="Purchase orders still waiting for goods — nearest expected date first" />
          {pendingOrders.length === 0 ? (
            <EmptyState>Everything ordered has arrived.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {pendingOrders.map((o) => (
                  <div key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-ink whitespace-nowrap">{poRef(o)}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusTone[o.status] || ''}`}>{statusLabel[o.status] || o.status}</span>
                        {o.overdue && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-600 text-white">Overdue</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {supplierName(o.supplierId)} · Ordered {new Date(o.createdAt).toLocaleDateString()}
                        {o.expectedDate ? ` · Expected ${o.expectedDate}` : ' · No expected date'}
                      </div>
                      <div className="text-xs text-ink/80 break-words">
                        {o.items
                          .map((it: any) => `${materialName(it.rawMaterialId)}: ${formatQuantityWithUnit(it.remainingQuantity ?? it.quantity, it.unit || materialUnit(it.rawMaterialId))} still to come`)
                          .join(', ')}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IconButton icon={Eye} title="View purchase order" onClick={() => openOrder(o)} />
                      <SecondaryButton icon={PackageCheck} requires="edit" onClick={() => openReceive(o)}>Receive</SecondaryButton>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {receivingOrder && (
            <ReceiveGoodsModal
              order={receivingOrder}
              supplierName={supplierName(receivingOrder.supplierId)}
              rawMaterials={rawMaterials}
              onClose={() => setReceivingOrder(null)}
              onSaved={() => {
                setReceivingOrder(null);
                refreshOrders();
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
        </>
      ) : tab === 'suppliers' ? (
        <>
          <PageHeader
            title="Suppliers"
            subtitle="Vendors you buy raw materials from"
            action={
              <div className="flex flex-wrap gap-2">
                <SecondaryButton icon={Upload} requires="edit" onClick={() => setShowImport(true)}>Import</SecondaryButton>
                <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNewSupplier(true)}>New supplier</PrimaryButton>
              </div>
            }
          />
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : suppliers.length === 0 ? (
            <EmptyState>No suppliers yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {suppliers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{s.name}</div>
                      <div className="text-xs text-muted">
                        {s.phone || s.email || '-'}
                        {' · '}
                        {s.vatStatus === 'foreign' ? 'Foreign' : s.vatStatus === 'not_registered' ? 'Not VAT registered' : s.vatin ? `VATIN ${s.vatin}` : 'VAT registered (no VATIN yet)'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
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
          {showImport && <ImportModal type="suppliers" label="Suppliers" onClose={() => setShowImport(false)} onImported={loadSuppliers} />}
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
                  <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{supplierName(r.supplierId)}</div>
                      <div className="text-xs text-muted">
                        <span className="whitespace-nowrap">{r.returnNumber}</span> · {r.date}
                        {orderNumber(r.purchaseOrderId) ? ` · ${orderNumber(r.purchaseOrderId)}` : ''}
                        {r.reason ? ` · ${r.reason}` : ''}
                        {r.status === 'rejected' && r.rejectionReason ? ` · Rejected: ${r.rejectionReason}` : ''}
                      </div>
                      {r.items?.length > 0 && (
                        <div className="text-xs text-muted">
                          {r.items
                            .map((it) => `${materialName(it.rawMaterialId)} × ${formatQuantityWithUnit(it.quantity, it.unit || materialUnit(it.rawMaterialId))}`)
                            .join(', ')}
                        </div>
                      )}
                      {r.status === 'approved' && (
                        <div className="text-xs text-muted">
                          Debit note on the order {Number(r.appliedToOrder || 0).toFixed(3)} OMR
                          {Number(r.refundAmount || 0) > 0 ? ` · Refunded by supplier ${Number(r.refundAmount).toFixed(3)} OMR` : ''}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(r.total).toFixed(3)} OMR</div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${returnStatusTone[r.status] || 'bg-black/5 text-ink/70'}`}>
                        {returnStatusLabel[r.status] || r.status}
                      </span>
                      {r.status === 'approved' && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Eye} title="View debit note" onClick={() => viewPdf(`/purchase-returns/${r.id}/pdf`)} />
                          <IconButton icon={Download} title="Download debit note" onClick={() => downloadPdf(`/purchase-returns/${r.id}/pdf`, `Debit-Note-${r.returnNumber}.pdf`)} />
                        </div>
                      )}
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Trash2} tone="danger" title="Delete return" requires="full" onClick={() => removeReturn(r.id)} />
                          {canDecide && (
                            <>
                              <IconButton icon={Check} tone="success" title="Approve & take out of stock" requires="edit" requiresModule="approvals" onClick={() => setApprovingReturn(r)} />
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
            <ApprovePurchaseReturnModal
              item={approvingReturn}
              poNumber={orderNumber(approvingReturn.purchaseOrderId)}
              bankAccounts={bankAccounts}
              onClose={() => setApprovingReturn(null)}
              onSaved={() => {
                setApprovingReturn(null);
                loadReturns();
                api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
              }}
            />
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
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-black/5">
                      <div className="text-sm font-semibold text-ink min-w-0">
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
                              quantity: quantityInputValue(it.suggestedQuantity, it.unit),
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
                        <div key={it.rawMaterialId} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-ink min-w-0">{it.name}</div>
                          <div className="text-xs text-muted sm:text-right">
                            <div>
                              {formatQuantityWithUnit(it.quantityInStock, it.unit)} in stock (alert at {formatQuantityWithUnit(it.lowStockThreshold, it.unit)})
                            </div>
                            <div className="text-amber-700 font-medium">
                              Suggested: {formatQuantityWithUnit(it.suggestedQuantity, it.unit)}
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

  function materialUnit(id: string) {
    return rawMaterials.find((r) => r.id === id)?.unit;
  }

  function orderTotal(order: PurchaseOrderHistoryItem) {
    return order.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.costPerUnit), 0);
  }

  return (
    <Modal title={`Supplier: ${supplier.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
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
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="text-sm">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
                        {statusLabel[o.status] || o.status}
                      </span>
                      <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-sm font-medium text-ink whitespace-nowrap">{orderTotal(o).toFixed(3)} OMR</div>
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {o.items.map((it) => `${materialName(it.rawMaterialId)} × ${formatQuantityWithUnit(it.quantity, it.unit || materialUnit(it.rawMaterialId))}`).join(', ')}
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
  const [vatStatus, setVatStatus] = useState<string>(supplier?.vatStatus || 'registered');
  const [vatin, setVatin] = useState(supplier?.vatin || '');
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
      vatStatus,
      vatin: vatin.trim() || undefined,
    };
    // set once the record exists: a failing attachment after that must not
    // lead to a second Save creating the record (and moving money) twice
    let created = false;
    try {
      let supplierId = supplier?.id;
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, payload);
      else {
        const res = await api.post('/suppliers', payload);
        supplierId = res.data.id;
        created = true;
      }
      // Bank accounts/documents are saved as a separate step since they
      // need the supplier's id, which only exists once created above.
      if (supplierId) {
        await saveBankAccounts(`/suppliers/${supplierId}`, bankAccounts);
        await savePartyDocuments(`/suppliers/${supplierId}`, documents);
      }
      onSaved();
    } catch (err: any) {
      if (created) {
        window.alert(`The supplier was saved, but bank details/documents could not be saved: ${err?.response?.data?.message || 'unknown error'}. Open it again (Edit) to add them.`);
        onSaved();
        return;
      }
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="VAT status">
            <select className={inputClass} value={vatStatus} onChange={(e) => setVatStatus(e.target.value)}>
              {VAT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={vatStatus === 'registered' ? 'VATIN (needed to claim input VAT)' : 'VATIN'}>
            <input className={inputClass} value={vatin} onChange={(e) => setVatin(e.target.value)} placeholder="OM1100XXXXXX" />
          </Field>
        </div>

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

// Read-only view of a purchase order: lines with ordered / received
// quantities, its goods receipts (GRNs) and the PO PDF.
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
  const ref = poRef(order);

  return (
    <Modal title={`${ref} — ${supplierName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted">Status:</span>{' '}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[order.status] || 'bg-black/5 text-ink/70'}`}>
              {statusLabel[order.status] || order.status}
              {order.closedShort ? ' (closed short)' : ''}
            </span>
          </div>
          <div><span className="text-muted">Ordered:</span> {new Date(order.createdAt).toLocaleDateString()}</div>
          <div><span className="text-muted">Expected:</span> {order.expectedDate || '-'}</div>
          <div><span className="text-muted">Received value:</span> {Number(order.receivedTotal || 0).toFixed(3)} OMR</div>
          {order.notes && <div className="sm:col-span-2"><span className="text-muted">Notes:</span> {order.notes}</div>}
        </div>
        <div className="border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-black/5 text-xs text-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Received</th>
                <th className="text-right px-3 py-2">Cost/unit</th>
                <th className="text-right px-3 py-2">VAT</th>
                <th className="text-right px-3 py-2">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {order.items.map((it, i) => {
                const unit = it.unit || materialUnit(it.rawMaterialId);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">{materialName(it.rawMaterialId)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(it.quantity, unit)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(it.receivedQuantity || 0, unit)}</td>
                    <td className="px-3 py-2 text-right">{Number(it.costPerUnit).toFixed(3)}</td>
                    <td className="px-3 py-2 text-right">{Number(it.vatRate ?? 0)}%</td>
                    <td className="px-3 py-2 text-right">{(Number(it.quantity) * Number(it.costPerUnit)).toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-sm">
              <tr className="border-t border-black/10">
                <td colSpan={5} className="px-3 py-1.5 text-right text-muted">Subtotal</td>
                <td className="px-3 py-1.5 text-right">{Number(order.subtotal || 0).toFixed(3)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="px-3 py-1.5 text-right text-muted">VAT</td>
                <td className="px-3 py-1.5 text-right">{Number(order.vatAmount || 0).toFixed(3)}</td>
              </tr>
              <tr className="font-semibold">
                <td colSpan={5} className="px-3 py-1.5 text-right">Order total</td>
                <td className="px-3 py-1.5 text-right">{Number(order.total || 0).toFixed(3)} OMR</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <span className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">Goods received ({order.goodsReceipts?.length || 0})</span>
          {!order.goodsReceipts?.length ? (
            <p className="text-sm text-muted">Nothing received yet.</p>
          ) : (
            <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
              {order.goodsReceipts.map((g) => (
                <div key={g.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{g.grnNumber} · {g.receivedDate}</div>
                    <div className="text-xs text-muted">
                      {g.supplierInvoiceNumber ? `Supplier invoice ${g.supplierInvoiceNumber}${g.supplierInvoiceDate ? ` (${g.supplierInvoiceDate})` : ''}` : 'No supplier invoice'}
                      {g.note ? ` · ${g.note}` : ''}
                    </div>
                    {!!g.items?.length && (
                      <div className="text-xs text-muted">
                        {g.items.map((i) => `${materialName(i.rawMaterialId)} × ${formatQuantityWithUnit(i.quantity, i.unit || materialUnit(i.rawMaterialId))}`).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="font-medium">{Number(g.total).toFixed(3)} OMR</div>
                    <div className="text-xs text-muted">VAT {Number(g.vatAmount).toFixed(3)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <SecondaryButton icon={Eye} onClick={() => viewPdf(`/purchase-orders/${order.id}/pdf`)}>View PDF</SecondaryButton>
          <SecondaryButton icon={Download} onClick={() => downloadPdf(`/purchase-orders/${order.id}/pdf`, `${ref}.pdf`)}>Download PDF</SecondaryButton>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

// One row of the Purchase Orders list.
function PurchaseOrderRow({
  order: o,
  supplierName,
  due,
  canDelete,
  onView,
  onReceive,
  onCancel,
  onClose,
  onPay,
  onReturn,
  onEdit,
  onDelete,
}: {
  order: PurchaseOrder;
  supplierName: string;
  due: number;
  canDelete: boolean;
  onView: () => void;
  onReceive: () => void;
  onCancel: () => void;
  onClose: () => void;
  onPay: () => void;
  onReturn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const received = o.status === 'received' || o.status === 'partially_received';
  const overdue = (o.status === 'ordered' || o.status === 'partially_received') && !!o.expectedDate && o.expectedDate < localISODate();
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-ink whitespace-nowrap">{poRef(o)}</span>
          {o.isOpening ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-black/5 text-ink/70" title="Unpaid supplier bill from the old books">
              Opening balance
            </span>
          ) : (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
              {statusLabel[o.status] || o.status}
            </span>
          )}
          {overdue && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-600 text-white">Overdue</span>}
        </div>
        <div className="text-xs text-muted">
          {o.isOpening
            ? `${supplierName} · from the old books · ${Number(o.total || 0).toFixed(3)} OMR${o.dueDate ? ` · due ${o.dueDate}` : ''}`
            : `${supplierName} · ${o.items?.length || 0} item(s) · ${Number(o.total || 0).toFixed(3)} OMR`}
          {o.expectedDate && !received ? ` · Expected ${o.expectedDate}` : ''}
          {o.status === 'partially_received' ? ` · Received ${Number(o.receivedTotal || 0).toFixed(3)} OMR so far` : ''}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {(o.status === 'ordered' || o.status === 'partially_received') && (
          <SecondaryButton icon={PackageCheck} requires="edit" onClick={onReceive}>
            {o.status === 'ordered' ? 'Receive' : 'Receive more'}
          </SecondaryButton>
        )}
        {o.status === 'ordered' && <SecondaryButton requires="edit" onClick={onCancel}>Cancel</SecondaryButton>}
        {o.status === 'partially_received' && <SecondaryButton requires="edit" onClick={onClose}>Close</SecondaryButton>}
        {received && (
          <>
            {due > 0.001 ? (
              <SecondaryButton icon={Wallet} requires="edit" onClick={onPay}>
                Pay ({due.toFixed(3)} due)
              </SecondaryButton>
            ) : (
              <button type="button" onClick={onPay} className="text-xs px-2 py-1 rounded-full font-medium bg-brand-50 text-brand-700">
                Paid
              </button>
            )}
            {!o.isOpening && <SecondaryButton icon={RotateCcw} requires="edit" onClick={onReturn}>Return</SecondaryButton>}
          </>
        )}
        <div className="flex items-center gap-1.5">
          {!o.isOpening && (
            <>
              <IconButton icon={Eye} title="View purchase order" onClick={onView} />
              <IconButton icon={Download} title="Download PO PDF" onClick={() => downloadPdf(`/purchase-orders/${o.id}/pdf`, `${poRef(o)}.pdf`)} />
            </>
          )}
          {o.status === 'ordered' && (
            <>
              <IconButton icon={Pencil} title="Edit" requires="edit" onClick={onEdit} />
              {canDelete && <IconButton icon={Trash2} tone="danger" title="Delete (Admin only)" requires="full" onClick={onDelete} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Goods Received Note: what arrived from this order (all or part). The
// supplier's tax invoice number/date are required when the goods carry
// VAT (needed to claim the input VAT).
function ReceiveGoodsModal({
  order,
  supplierName,
  rawMaterials,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder;
  supplierName: string;
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const lines = order.items
    .map((it) => {
      const unit = normalizeUnit(it.unit || rawMaterials.find((r) => r.id === it.rawMaterialId)?.unit);
      const remaining = Math.max(0, Math.round((Number(it.quantity) - Number(it.receivedQuantity || 0)) * 1000) / 1000);
      return { ...it, unit, remaining };
    })
    .filter((l) => l.remaining > 0.0005);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [String(l.id), quantityInputValue(l.remaining, l.unit)])));
  const [receivedDate, setReceivedDate] = useState(localISODate());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const carriesVat = lines.some((l) => Number(l.vatRate || 0) > 0 && Number(qty[String(l.id)] || 0) > 0);
  const value = lines.reduce((sum, l) => {
    const q = Number(qty[String(l.id)] || 0);
    const net = q * Number(l.costPerUnit);
    return sum + net + (net * Number(l.vatRate || 0)) / 100;
  }, 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const items = lines.map((l) => ({ purchaseOrderItemId: String(l.id), quantity: Number(qty[String(l.id)] || 0) })).filter((i) => i.quantity > 0);
    if (!items.length) {
      setError('Enter the quantity that arrived for at least one line.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/purchase-orders/${order.id}/receive`, {
        items,
        receivedDate,
        supplierInvoiceNumber: invoiceNumber || undefined,
        supplierInvoiceDate: invoiceDate || undefined,
        note: note || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not record this delivery.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Receive goods — ${poRef(order)} · ${supplierName}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-black/5 text-xs text-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Still to come</th>
                <th className="text-right px-3 py-2">Arrived now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {lines.map((l) => (
                <tr key={String(l.id)}>
                  <td className="px-3 py-2">{rawMaterials.find((r) => r.id === l.rawMaterialId)?.name || 'Item'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(l.remaining, l.unit)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <input
                        className={`${inputClass} text-right max-w-[7rem]`}
                        type="number"
                        step={quantityInputStep(l.unit)}
                        min="0"
                        max={l.remaining}
                        value={qty[String(l.id)] ?? ''}
                        onChange={(e) => setQty((p) => ({ ...p, [String(l.id)]: e.target.value }))}
                        onBlur={(e) =>
                          setQty((p) => ({ ...p, [String(l.id)]: String(Math.min(snapQuantityToUnit(Number(e.target.value) || 0, l.unit), l.remaining)) }))
                        }
                      />
                      <span className="shrink-0 text-xs text-muted">{unitLabel(l.unit)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Received on">
            <input className={inputClass} type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} required />
          </Field>
          <Field label={carriesVat ? 'Supplier invoice no. (required)' : 'Supplier invoice no.'}>
            <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required={carriesVat} />
          </Field>
          <Field label={carriesVat ? 'Invoice date (required)' : 'Invoice date'}>
            <input className={inputClass} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required={carriesVat} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. truck no., delivered by" />
        </Field>
        <p className="text-xs text-muted">
          This delivery adds the goods to stock and {value.toFixed(3)} OMR (incl. VAT) to what you owe the supplier.
          {carriesVat ? ' The supplier\'s tax invoice is needed to claim the input VAT.' : ''}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Record delivery'}</PrimaryButton>
        </div>
      </form>
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
  const [total, setTotal] = useState(Number(order.receivedTotal || 0));
  const [paidAmount, setPaidAmount] = useState(Number(order.paidAmount || 0));

  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('bank_transfer');
  const [paymentDate, setPaymentDate] = useState(localISODate());
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
      setTotal(Number(res.data.receivedTotal || 0));
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
    if (!window.confirm('Remove this payment entry?')) return;
    try {
      await api.delete(`/purchase-orders/${order.id}/payments/${id}`);
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not remove this payment.');
    }
    load();
    onChanged();
  }

  return (
    <Modal title={`Pay bill — ${poRef(order)} · ${supplierName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-muted">Received value (owed)</div>
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
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="text-sm min-w-0">
                    <div className="font-medium text-ink">{Number(p.amount).toFixed(3)} OMR</div>
                    <div className="text-xs text-muted">
                      {p.paymentDate} · {p.creditSource ? CREDIT_SOURCE_LABEL[p.creditSource] || 'Credit' : labelFor(PAYMENT_TYPE_OPTIONS, p.paymentType)}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                  </div>
                  {!p.creditSource && <IconButton icon={Trash2} tone="danger" title="Remove" requires="full" onClick={() => removePayment(p.id)} />}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Payment Type">
                <select className={inputClass} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                  {PAYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
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
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate || '');
  const supplierVat = suppliers.find((s) => s.id === supplierId)?.vatStatus || 'registered';
  // Each line's unit comes from its raw material (fixed in Inventory) — it
  // drives the Qty step/snap and is shown read-only next to the input.
  function materialUnit(id: string): string {
    return normalizeUnit(rawMaterials.find((r) => r.id === id)?.unit);
  }
  const [items, setItems] = useState(
    order && order.items.length > 0
      ? order.items.map((it) => {
          const unit = rawMaterials.some((r) => r.id === it.rawMaterialId) ? materialUnit(it.rawMaterialId) : normalizeUnit(it.unit);
          return { _key: newItemKey(), rawMaterialId: it.rawMaterialId, unit, quantity: quantityInputValue(it.quantity, unit), costPerUnit: String(it.costPerUnit) };
        })
      : initial && initial.items.length > 0
      ? initial.items.map((it) => ({ _key: newItemKey(), rawMaterialId: it.rawMaterialId, unit: materialUnit(it.rawMaterialId), quantity: it.quantity, costPerUnit: it.costPerUnit }))
      : [{ _key: newItemKey(), rawMaterialId: rawMaterials[0]?.id || '', unit: materialUnit(rawMaterials[0]?.id || ''), quantity: '1', costPerUnit: '0' }],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateItem(i: number, patch: Partial<{ rawMaterialId: string; unit: string; quantity: string; costPerUnit: string }>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      supplierId,
      notes: notes || undefined,
      expectedDate: expectedDate || undefined,
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
            <div key={item._key} className="grid grid-cols-[1fr_64px_1fr] gap-2 items-center sm:grid-cols-[1fr_100px_64px_120px]">
              <select
                className={`${inputClass} col-span-3 sm:col-span-1`}
                value={item.rawMaterialId}
                onChange={(e) => {
                  const unit = materialUnit(e.target.value);
                  updateItem(i, {
                    rawMaterialId: e.target.value,
                    unit,
                    quantity: String(snapQuantityToUnit(Number(item.quantity) || 0, unit) || 1),
                  });
                }}
              >
                {rawMaterials.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                type="number"
                step={quantityInputStep(item.unit)}
                min={quantityInputMin(item.unit)}
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
              <div className="h-full flex items-center justify-center rounded-lg bg-black/5 px-2 text-sm text-ink/70" title="Unit comes from the raw material">
                {unitLabel(item.unit)}
              </div>
              <input className={inputClass} type="number" step="0.001" min="0" placeholder="Cost/unit" value={item.costPerUnit} onChange={(e) => updateItem(i, { costPerUnit: e.target.value })} />
            </div>
          ))}
          <SecondaryButton onClick={() => setItems((prev) => [...prev, { _key: newItemKey(), rawMaterialId: rawMaterials[0]?.id || '', unit: materialUnit(rawMaterials[0]?.id || ''), quantity: '1', costPerUnit: '0' }])}>
            + Add item
          </SecondaryButton>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Expected delivery date (optional)">
            <input className={inputClass} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          {supplierVat === 'registered'
            ? 'This supplier is Oman VAT registered: 5% VAT is added to each line.'
            : supplierVat === 'foreign'
            ? 'Foreign supplier: no VAT on this order (import VAT is paid at customs).'
            : 'This supplier is not VAT registered: no VAT on this order.'}
        </p>
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
  onClose,
  onSaved,
}: {
  order: PurchaseOrder;
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(
    // Return quantities follow the PO line's own unit (falls back to the
    // raw material's unit for lines saved before units were stored).
    // only what has actually arrived can go back
    order.items
      .filter((it) => Number(it.receivedQuantity || 0) > 0)
      .map((it) => ({
        rawMaterialId: it.rawMaterialId,
        unit: it.unit || rawMaterials.find((r) => r.id === it.rawMaterialId)?.unit,
        maxQty: Number(it.receivedQuantity || 0),
        quantity: '0',
      })),
  );
  const [date, setDate] = useState(localISODate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function materialName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
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
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create this return.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Return items — ${poRef(order)}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-black/5 text-xs text-muted">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Received</th>
                <th className="text-right px-3 py-2">Return qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {items.map((it, i) => (
                <tr key={it.rawMaterialId}>
                  <td className="px-3 py-2">{materialName(it.rawMaterialId)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(it.maxQty, it.unit)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step={quantityInputStep(it.unit)}
                        min="0"
                        max={Number(it.maxQty)}
                        value={it.quantity}
                        onChange={(e) => updateQty(i, e.target.value)}
                        onBlur={(e) => updateQty(i, String(snapQuantityToUnit(Number(e.target.value) || 0, it.unit)))}
                      />
                      <span className="shrink-0 text-xs text-muted">{unitLabel(it.unit)}</span>
                    </div>
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
        <p className="text-xs text-muted">
          The amount comes from this order's prices and VAT. Stock and money move only when an Admin, CEO, MD or Accountant approves it.
        </p>
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

// Approve a purchase return: shows how the money settles first - a debit
// note lowers what is still owed on the order; only when the order was
// already paid beyond that does the supplier refund the rest.
function ApprovePurchaseReturnModal({
  item,
  poNumber,
  bankAccounts,
  onClose,
  onSaved,
}: {
  item: PurchaseReturn;
  poNumber: string;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settlement, setSettlement] = useState<{ total: number; outstanding: number; appliedToOrder: number; refundAmount: number; refundAccountRequired: boolean } | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/purchase-returns/${item.id}/settlement`)
      .then((res) => setSettlement(res.data))
      .catch((err) => setError(err?.response?.data?.message || 'Could not load the amounts.'));
  }, [item.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/purchase-returns/${item.id}/approve`, { bankAccountId: bankAccountId || undefined });
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
      <form onSubmit={onSubmit} className="space-y-3 text-sm">
        {poNumber && <div className="text-xs text-muted">Purchase order {poNumber}</div>}
        <div className="rounded-lg border border-black/10 p-3 space-y-1">
          {row('Goods returned (cost)', Number(item.subtotal))}
          {row('Input VAT reversed', Number(item.vatAmount))}
          {row('Total', Number(item.total), true)}
        </div>
        {!settlement ? (
          !error && <div className="text-muted">Loading…</div>
        ) : (
          <div className="rounded-lg border border-black/10 p-3 space-y-1">
            {row('Still owed on the order', settlement.outstanding)}
            {row('Debit note on the order', settlement.appliedToOrder, true)}
            {row('Refund from supplier', settlement.refundAmount, true)}
          </div>
        )}
        {settlement?.refundAccountRequired && (
          <Field label="Refund received into">
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
        <p className="text-xs text-muted">The goods are taken out of stock when you approve.</p>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" requiresModule="approvals" disabled={busy || !settlement}>
            {busy ? 'Approving…' : 'Approve & take out of stock'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
