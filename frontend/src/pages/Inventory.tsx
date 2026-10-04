import { FormEvent, useEffect, useState } from 'react';
import { ScanLine, Plus, Pencil, Eye, Trash2, PackagePlus } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import {
  UNIT_OPTIONS,
  formatQuantity,
  formatQuantityWithUnit,
  isDecimalUnit,
  normalizeUnit,
  quantityInputMin,
  quantityInputStep,
  quantityInputValue,
  snapQuantityToUnit,
  unitLabel,
} from '../utils/formatQuantity';

interface StockItem {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  unit: string;
  quantityInStock: number;
  lowStockThreshold: number;
  sellingPrice?: number;
  costPerUnit?: number;
  supplierId?: string;
  reorderQuantity?: number | string;
}
interface Supplier {
  id: string;
  name: string;
}
interface Customer {
  id: string;
  name: string;
}
interface SalesOrder {
  id: string;
  customerId: string;
}
interface ProductionOrder {
  id: string;
  finishedGoodId: string;
  quantityToProduce: number;
  status: string;
  notes?: string;
}
interface BomLine {
  id: string;
  finishedGoodId: string;
  rawMaterialId: string;
  quantityPerUnit: number;
}
interface RawMaterialBatch {
  id: string;
  rawMaterialId: string;
  batchNumber: string;
  quantityReceived: number | string;
  quantityRemaining: number | string;
  costPerUnit: number | string;
  source: string;
  purchaseOrderId?: string;
  supplierId?: string;
  receivedDate: string;
}
interface FinishedGoodBatch {
  id: string;
  finishedGoodId: string;
  batchNumber: string;
  quantityProduced: number | string;
  quantityRemaining: number | string;
  source: string;
  productionOrderId?: string;
  producedDate: string;
}
interface ProductionBatchConsumption {
  id: string;
  productionOrderId: string;
  finishedGoodBatchId: string;
  rawMaterialBatchId: string;
  rawMaterialId: string;
  quantityConsumed: number | string;
}
interface SalesBatchConsumption {
  id: string;
  salesOrderId?: string;
  invoiceId?: string | null;
  finishedGoodBatchId: string;
  finishedGoodId: string;
  quantityConsumed: number | string;
}

// Matches ProductionOrderStatus in the backend entity — 'planned', not
// 'pending' (a mismatch here previously meant the tone/label and the
// Complete/Cancel buttons never showed for a freshly-created order).
const statusTone: Record<string, string> = {
  planned: 'bg-amber-50 text-amber-700',
  completed: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
};

const sourceLabel: Record<string, string> = {
  purchase_order: 'Purchase Order',
  production_order: 'Production Order',
  manual: 'Manual / Scan',
  opening_balance: 'Opening Balance',
};
const sourceTone: Record<string, string> = {
  purchase_order: 'bg-brand-50 text-brand-700',
  production_order: 'bg-brand-50 text-brand-700',
  manual: 'bg-black/5 text-ink/70',
  opening_balance: 'bg-amber-50 text-amber-700',
};

type Tab = 'finished' | 'raw' | 'orders' | 'bom' | 'raw-batches' | 'finished-batches';

// Raw material amounts derived from a recipe (quantityPerUnit x quantity
// produced) can be fractional even for Pcs/Bags materials - show those with
// decimals instead of rounding them away; everything else uses the normal
// unit formatting ("10 Bags", "2.500 Kgs").
function formatDerivedNumber(qty: number | string, unit?: string | null): string {
  const n = Math.round((Number(qty) || 0) * 1000) / 1000;
  if (!isDecimalUnit(unit) && !Number.isInteger(n)) return String(n);
  return formatQuantity(n, unit);
}
function formatDerivedQuantity(qty: number | string, unit?: string | null): string {
  return `${formatDerivedNumber(qty, unit)} ${unitLabel(unit)}`;
}

// Recipe ratio (raw material per 1 unit of finished good) - up to 4
// decimals, trailing zeros trimmed ("0.25", "2").
function formatRatio(qty: number | string): string {
  return String(Math.round((Number(qty) || 0) * 10000) / 10000);
}

export default function Inventory() {
  const { hasAnyRole, canAccessModule } = useAuth();
  const canDelete = hasAnyRole(['admin']);
  const [tab, setTab] = useState<Tab>('finished');

  // Stock items (Finished Goods / Raw Materials)
  const [items, setItems] = useState<StockItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [viewingItem, setViewingItem] = useState<StockItem | null>(null);
  const [showScan, setShowScan] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);

  // Production Orders / BOM
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<StockItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<StockItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ProductionOrder | null>(null);
  const [selectedFg, setSelectedFg] = useState<string>('');
  const [bomLines, setBomLines] = useState<BomLine[]>([]);
  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLine, setEditingLine] = useState<BomLine | null>(null);

  // Traceability
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [invoiceRefs, setInvoiceRefs] = useState<{ id: string; invoiceNumber: string; customerId: string }[]>([]);
  const [rawFilter, setRawFilter] = useState('');
  const [finishedFilter, setFinishedFilter] = useState('');
  const [rawBatches, setRawBatches] = useState<RawMaterialBatch[]>([]);
  const [finishedBatches, setFinishedBatches] = useState<FinishedGoodBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(true);
  const [viewingRawBatch, setViewingRawBatch] = useState<RawMaterialBatch | null>(null);
  const [viewingFinishedBatch, setViewingFinishedBatch] = useState<FinishedGoodBatch | null>(null);

  // Shared reference data — loaded once, used across all tabs.
  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data));
    api.get('/customers').then((res) => setCustomers(res.data));
    api.get('/sales-orders').then((res) => setSalesOrders(res.data));
    // stock leaves with invoices: trace rows name the invoice
    if (canAccessModule('invoices')) api.get('/invoices').then((res) => setInvoiceRefs(res.data)).catch(() => undefined);
    api.get('/finished-goods').then((res) => {
      setFinishedGoods(res.data);
      setSelectedFg((prev) => prev || res.data[0]?.id || '');
    });
    api.get('/raw-materials').then((res) => setRawMaterials(res.data));
  }, []);

  function loadItems() {
    setLoading(true);
    const url = tab === 'finished' ? '/finished-goods' : '/raw-materials';
    api.get(url).then((res) => setItems(res.data)).finally(() => setLoading(false));
  }
  function loadOrders() {
    setOrdersLoading(true);
    api.get('/production-orders').then((res) => setOrders(res.data)).finally(() => setOrdersLoading(false));
  }
  function loadBomLines() {
    if (!selectedFg) return;
    api.get(`/bom/finished-good/${selectedFg}`).then((res) => setBomLines(res.data));
  }
  function loadRawBatches() {
    setBatchLoading(true);
    api
      .get('/raw-material-batches', { params: rawFilter ? { rawMaterialId: rawFilter } : {} })
      .then((res) => setRawBatches(res.data))
      .finally(() => setBatchLoading(false));
  }
  function loadFinishedBatches() {
    setBatchLoading(true);
    api
      .get('/finished-good-batches', { params: finishedFilter ? { finishedGoodId: finishedFilter } : {} })
      .then((res) => setFinishedBatches(res.data))
      .finally(() => setBatchLoading(false));
  }

  function refreshStockLookups() {
    api.get('/finished-goods').then((res) => setFinishedGoods(res.data));
    api.get('/raw-materials').then((res) => setRawMaterials(res.data));
  }

  useEffect(() => {
    if (tab === 'finished' || tab === 'raw') loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === 'orders') loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === 'bom' && selectedFg) loadBomLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedFg]);

  useEffect(() => {
    if (tab === 'raw-batches') loadRawBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rawFilter]);

  useEffect(() => {
    if (tab === 'finished-batches') loadFinishedBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, finishedFilter]);

  function supplierName(id?: string) {
    if (!id) return undefined;
    return suppliers.find((s) => s.id === id)?.name;
  }
  function fgName(id: string) {
    return finishedGoods.find((f) => f.id === id)?.name || id;
  }
  function rmName(id: string) {
    return rawMaterials.find((r) => r.id === id)?.name || id;
  }
  function rmUnit(id: string) {
    return rawMaterials.find((r) => r.id === id)?.unit;
  }
  function fgUnit(id: string) {
    return finishedGoods.find((f) => f.id === id)?.unit;
  }
  function customerNameForOrder(salesOrderId?: string, invoiceId?: string | null) {
    if (invoiceId) {
      const inv = invoiceRefs.find((i) => i.id === invoiceId);
      if (!inv) return 'Invoice (deleted or not visible)';
      return `${inv.invoiceNumber} — ${customers.find((c) => c.id === inv.customerId)?.name || 'Unknown customer'}`;
    }
    if (!salesOrderId) return 'Manual stock-out / delivery to waiting invoice';
    const order = salesOrders.find((o) => o.id === salesOrderId);
    if (!order) return 'Unknown sales order';
    return customers.find((c) => c.id === order.customerId)?.name || 'Unknown customer';
  }

  async function removeItem(item: StockItem) {
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
    try {
      const url = tab === 'finished' ? `/finished-goods/${item.id}` : `/raw-materials/${item.id}`;
      await api.delete(url);
      loadItems();
      refreshStockLookups();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not delete ${item.name}.`);
    }
  }

  async function act(id: string, action: 'complete' | 'cancel') {
    try {
      await api.post(`/production-orders/${id}/${action}`);
      loadOrders();
      refreshStockLookups();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || `Could not ${action} this production order.`);
    }
  }

  async function removeOrder(id: string) {
    if (!window.confirm('Delete this production order? This cannot be undone.')) return;
    try {
      await api.delete(`/production-orders/${id}`);
      loadOrders();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this production order.');
    }
  }

  async function removeBomLine(id: string) {
    if (!window.confirm('Remove this ingredient from the recipe?')) return;
    try {
      await api.delete(`/bom/${id}`);
      loadBomLines();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not remove this ingredient.');
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Pill
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'finished', label: 'Finished Goods' },
            { value: 'raw', label: 'Raw Materials' },
            { value: 'orders', label: 'Production Orders' },
            { value: 'bom', label: 'Recipes (BOM)' },
            { value: 'raw-batches', label: 'Raw Material Batches' },
            { value: 'finished-batches', label: 'Finished Good Batches' },
          ]}
        />
      </div>

      {(tab === 'finished' || tab === 'raw') && (
        <>
          <PageHeader
            title={tab === 'finished' ? 'Finished Goods' : 'Raw Materials'}
            subtitle={tab === 'finished' ? 'Manufactured products ready for sale' : 'Materials used to manufacture finished goods'}
            action={
              <div className="flex flex-wrap gap-2">
                {tab === 'finished' && <SecondaryButton icon={ScanLine} requires="edit" onClick={() => setShowScan(true)}>Scan stock</SecondaryButton>}
                {items.length > 0 && (
                  <SecondaryButton icon={PackagePlus} requires="edit" onClick={() => setShowAddStock(true)}>Add stock</SecondaryButton>
                )}
                <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>Add product</PrimaryButton>
              </div>
            }
          />

          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : items.length === 0 ? (
            <EmptyState>No {tab === 'finished' ? 'finished goods' : 'raw materials'} yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {items.map((item) => {
                  const low = Number(item.quantityInStock) <= Number(item.lowStockThreshold);
                  return (
                    <div key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {low && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500" />}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink">{item.name}</div>
                          <div className="text-xs text-muted">
                            {item.barcode || item.sku || '-'}
                            {tab === 'raw' && item.supplierId && ` · ${supplierName(item.supplierId) || 'Unknown supplier'}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                        <div className="sm:text-right">
                          <div className="text-sm font-semibold text-ink whitespace-nowrap">
                            {formatQuantityWithUnit(item.quantityInStock, item.unit)}
                          </div>
                          {low && <div className="text-xs text-amber-600">Low stock</div>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Eye} title="View" onClick={() => setViewingItem(item)} />
                          <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditingItem(item)} />
                          {canDelete && (
                            <IconButton icon={Trash2} tone="danger" title="Delete (Admin only)" requires="full" onClick={() => removeItem(item)} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {viewingItem && (
            <StockItemDetailModal
              item={viewingItem}
              kind={tab}
              supplierName={tab === 'raw' ? supplierName(viewingItem.supplierId) : undefined}
              onClose={() => setViewingItem(null)}
            />
          )}
          {showAdd && (
            <AddProductModal
              kind={tab}
              suppliers={suppliers}
              onClose={() => setShowAdd(false)}
              onSaved={() => {
                setShowAdd(false);
                loadItems();
                refreshStockLookups();
              }}
            />
          )}
          {editingItem && (
            <AddProductModal
              kind={tab}
              item={editingItem}
              suppliers={suppliers}
              onClose={() => setEditingItem(null)}
              onSaved={() => {
                setEditingItem(null);
                loadItems();
                refreshStockLookups();
              }}
            />
          )}
          {showScan && (
            <ScanStockModal
              finishedGoods={finishedGoods}
              onClose={() => setShowScan(false)}
              onSaved={() => {
                setShowScan(false);
                loadItems();
                refreshStockLookups();
              }}
            />
          )}
          {showAddStock && (
            <AddStockModal
              kind={tab}
              items={items}
              onClose={() => setShowAddStock(false)}
              onSaved={() => {
                setShowAddStock(false);
                loadItems();
                refreshStockLookups();
              }}
            />
          )}
        </>
      )}

      {tab === 'orders' && (
        <>
          <PageHeader
            title="Production Orders"
            subtitle="Manufacturing runs against your recipes"
            action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowNewOrder(true)}>New production order</PrimaryButton>}
          />
          {ordersLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : orders.length === 0 ? (
            <EmptyState>No production orders yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {orders.map((o) => (
                  <div key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{fgName(o.finishedGoodId)}</div>
                      <div className="text-xs text-muted">
                        {formatQuantityWithUnit(o.quantityToProduce, fgUnit(o.finishedGoodId))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusTone[o.status] || 'bg-black/5 text-ink/70'}`}>
                        {o.status}
                      </span>
                      {o.status === 'planned' && (
                        <>
                          <SecondaryButton requires="edit" onClick={() => act(o.id, 'complete')}>Complete</SecondaryButton>
                          <SecondaryButton requires="edit" onClick={() => act(o.id, 'cancel')}>Cancel</SecondaryButton>
                        </>
                      )}
                      <div className="flex items-center gap-1.5">
                        <IconButton icon={Eye} title="View" onClick={() => setViewingOrder(o)} />
                        {o.status === 'planned' && (
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
          {showNewOrder && (
            <NewProductionOrderModal
              finishedGoods={finishedGoods}
              onClose={() => setShowNewOrder(false)}
              onSaved={() => {
                setShowNewOrder(false);
                loadOrders();
              }}
            />
          )}
          {editingOrder && (
            <NewProductionOrderModal
              order={editingOrder}
              finishedGoods={finishedGoods}
              onClose={() => setEditingOrder(null)}
              onSaved={() => {
                setEditingOrder(null);
                loadOrders();
              }}
            />
          )}
          {viewingOrder && (
            <ProductionOrderDetailModal
              order={viewingOrder}
              finishedGoodName={fgName(viewingOrder.finishedGoodId)}
              finishedGoodUnit={fgUnit(viewingOrder.finishedGoodId)}
              rmName={rmName}
              rmUnit={rmUnit}
              onClose={() => setViewingOrder(null)}
            />
          )}
        </>
      )}

      {tab === 'bom' && (
        <>
          <PageHeader
            title="Recipes (BOM)"
            subtitle="How much raw material each finished good needs"
            action={<PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddLine(true)}>Add ingredient</PrimaryButton>}
          />
          <div className="mb-4 max-w-xs">
            <select className={inputClass} value={selectedFg} onChange={(e) => setSelectedFg(e.target.value)}>
              {finishedGoods.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {bomLines.length === 0 ? (
            <EmptyState>No recipe lines for this product yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {bomLines.map((line) => (
                  <div key={line.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">{rmName(line.rawMaterialId)}</span>
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                      <span className="text-muted whitespace-nowrap">
                        {formatRatio(line.quantityPerUnit)} {unitLabel(rmUnit(line.rawMaterialId))} per {unitLabel(fgUnit(line.finishedGoodId))}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditingLine(line)} />
                        <IconButton icon={Trash2} tone="danger" title="Remove" requires="full" onClick={() => removeBomLine(line.id)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {showAddLine && (
            <BomLineModal
              finishedGoodId={selectedFg}
              finishedGoodUnit={fgUnit(selectedFg)}
              rawMaterials={rawMaterials}
              onClose={() => setShowAddLine(false)}
              onSaved={() => {
                setShowAddLine(false);
                loadBomLines();
              }}
            />
          )}
          {editingLine && (
            <BomLineModal
              line={editingLine}
              finishedGoodId={selectedFg}
              finishedGoodUnit={fgUnit(selectedFg)}
              rawMaterials={rawMaterials}
              onClose={() => setEditingLine(null)}
              onSaved={() => {
                setEditingLine(null);
                loadBomLines();
              }}
            />
          )}
        </>
      )}

      {tab === 'raw-batches' && (
        <>
          <PageHeader
            title="Raw Material Batches"
            subtitle="Every raw material lot received — click a row to trace it forward to production and sales"
          />
          <div className="mb-3 max-w-xs">
            <Field label="Filter by raw material">
              <select className={inputClass} value={rawFilter} onChange={(e) => setRawFilter(e.target.value)}>
                <option value="">All raw materials</option>
                {rawMaterials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {batchLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : rawBatches.length === 0 ? (
            <EmptyState>No raw material batches yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {rawBatches.map((b) => (
                  <div key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink whitespace-nowrap">{b.batchNumber}</div>
                      <div className="text-xs text-muted">
                        {rmName(b.rawMaterialId)}
                        {supplierName(b.supplierId) && ` · ${supplierName(b.supplierId)}`}
                        {' · '}
                        {b.receivedDate}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${sourceTone[b.source] || 'bg-black/5 text-ink/70'}`}>
                        {sourceLabel[b.source] || b.source}
                      </span>
                      <div className="sm:text-right">
                        <div className="text-sm font-semibold text-ink whitespace-nowrap">
                          {formatDerivedNumber(b.quantityRemaining, rmUnit(b.rawMaterialId))} /{' '}
                          {formatQuantityWithUnit(b.quantityReceived, rmUnit(b.rawMaterialId))}
                        </div>
                        <div className="text-xs text-muted">remaining</div>
                      </div>
                      <IconButton icon={Eye} title="Trace forward" onClick={() => setViewingRawBatch(b)} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {viewingRawBatch && (
            <RawBatchTraceModal
              batch={viewingRawBatch}
              rawMaterialName={rmName(viewingRawBatch.rawMaterialId)}
              rawMaterialUnit={rmUnit(viewingRawBatch.rawMaterialId)}
              finishedGoodUnit={fgUnit}
              supplierName={supplierName(viewingRawBatch.supplierId) || null}
              finishedGoodName={fgName}
              customerNameForOrder={customerNameForOrder}
              onClose={() => setViewingRawBatch(null)}
            />
          )}
        </>
      )}

      {tab === 'finished-batches' && (
        <>
          <PageHeader
            title="Finished Good Batches"
            subtitle="Every finished good lot produced — click a row to trace it back to raw materials and suppliers"
          />
          <div className="mb-3 max-w-xs">
            <Field label="Filter by product">
              <select className={inputClass} value={finishedFilter} onChange={(e) => setFinishedFilter(e.target.value)}>
                <option value="">All products</option>
                {finishedGoods.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {batchLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : finishedBatches.length === 0 ? (
            <EmptyState>No finished good batches yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {finishedBatches.map((b) => (
                  <div key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink whitespace-nowrap">{b.batchNumber}</div>
                      <div className="text-xs text-muted">
                        {fgName(b.finishedGoodId)} · {b.producedDate}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${sourceTone[b.source] || 'bg-black/5 text-ink/70'}`}>
                        {sourceLabel[b.source] || b.source}
                      </span>
                      <div className="sm:text-right">
                        <div className="text-sm font-semibold text-ink whitespace-nowrap">
                          {formatQuantity(b.quantityRemaining, fgUnit(b.finishedGoodId))} / {formatQuantityWithUnit(b.quantityProduced, fgUnit(b.finishedGoodId))}
                        </div>
                        <div className="text-xs text-muted">remaining</div>
                      </div>
                      <IconButton icon={Eye} title="Trace back to raw materials" onClick={() => setViewingFinishedBatch(b)} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {viewingFinishedBatch && (
            <FinishedBatchTraceModal
              batch={viewingFinishedBatch}
              finishedGoodName={fgName(viewingFinishedBatch.finishedGoodId)}
              finishedGoodUnit={fgUnit(viewingFinishedBatch.finishedGoodId)}
              rawMaterialName={rmName}
              rawMaterialUnit={rmUnit}
              supplierName={(id?: string) => supplierName(id) || null}
              customerNameForOrder={customerNameForOrder}
              onClose={() => setViewingFinishedBatch(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function AddProductModal({
  kind,
  item,
  suppliers,
  onClose,
  onSaved,
}: {
  kind: 'finished' | 'raw';
  item?: StockItem;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [barcode, setBarcode] = useState(item?.barcode || '');
  const [sku, setSku] = useState(item?.sku || '');
  // Fixed unit list (Pcs/Bags/Kgs/Litre/Tons) — chosen once here; every
  // document line for this product takes it automatically. Old free-text
  // units are pre-selected via normalizeUnit; new products must pick one.
  const [unit, setUnit] = useState<string>(item ? normalizeUnit(item.unit) : '');
  const [quantityInStock, setQuantityInStock] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState(item ? quantityInputValue(item.lowStockThreshold, item.unit) : '0');
  const [price, setPrice] = useState(item ? String(item.sellingPrice ?? item.costPerUnit ?? 0) : '0');
  // Finished-good-only — production cost per unit, used for COGS/Gross
  // Profit on the Dashboard. Auto-updated (weighted average) whenever a
  // Production Order completes; editable here too, e.g. to set a starting
  // value for a product that's never gone through a BOM yet.
  const [finishedGoodCost, setFinishedGoodCost] = useState(item ? String(item.costPerUnit ?? 0) : '0');
  // Raw-material-only fields (Inventory Reorder Automation).
  const [supplierId, setSupplierId] = useState(item?.supplierId || '');
  const [reorderQuantity, setReorderQuantity] = useState(
    item?.reorderQuantity !== undefined && item?.reorderQuantity !== null && item?.reorderQuantity !== ''
      ? quantityInputValue(item.reorderQuantity, item.unit)
      : '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Switching unit re-snaps the quantities already typed (e.g. 2.5 -> 3
  // when going from Kgs to Bags).
  function changeUnit(next: string) {
    setUnit(next);
    const snap = (v: string) => (v === '' ? '' : String(snapQuantityToUnit(Number(v) || 0, next)));
    setQuantityInStock(snap);
    setLowStockThreshold(snap);
    setReorderQuantity(snap);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!unit) {
      setError('Please choose a unit.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (kind === 'finished') {
        const payload = {
          name,
          barcode,
          sku: sku || undefined,
          unit,
          // Opening stock only applies when creating a new item — once it
          // exists, quantity only changes via "Add stock"/production/sale
          // so every change gets a batch record and a journal entry.
          ...(item ? {} : { quantityInStock: Number(quantityInStock) }),
          lowStockThreshold: Number(lowStockThreshold),
          sellingPrice: Number(price),
          costPerUnit: Number(finishedGoodCost),
        };
        if (item) await api.patch(`/finished-goods/${item.id}`, payload);
        else await api.post('/finished-goods', payload);
      } else {
        const payload = {
          name,
          sku: sku || undefined,
          barcode: barcode || undefined,
          unit,
          ...(item ? {} : { quantityInStock: Number(quantityInStock) }),
          lowStockThreshold: Number(lowStockThreshold),
          costPerUnit: Number(price),
          supplierId: supplierId || undefined,
          reorderQuantity: reorderQuantity ? Number(reorderQuantity) : undefined,
        };
        if (item) await api.patch(`/raw-materials/${item.id}`, payload);
        else await api.post('/raw-materials', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? `Edit ${kind === 'finished' ? 'finished good' : 'raw material'}` : kind === 'finished' ? 'Add finished good' : 'Add raw material'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'finished' ? 'Barcode' : 'Barcode (optional)'}>
            <input className={inputClass} value={barcode} onChange={(e) => setBarcode(e.target.value)} required={kind === 'finished'} />
          </Field>
          <Field label="SKU (optional)">
            <input className={inputClass} value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Unit">
            <select className={inputClass} value={unit} onChange={(e) => changeUnit(e.target.value)} required>
              <option value="" disabled>
                Select unit
              </option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          {item ? (
            <Field label="Current stock">
              <input className={`${inputClass} bg-slate-50 text-slate-500`} value={formatQuantityWithUnit(item.quantityInStock, item.unit)} disabled />
              <p className="mt-1 text-xs text-slate-500">Use "Add stock" to change quantity.</p>
            </Field>
          ) : (
            <Field label={`Opening stock${unit ? ` (${unitLabel(unit)})` : ''}`}>
              <input
                className={inputClass}
                type="number"
                step={quantityInputStep(unit)}
                min="0"
                value={quantityInStock}
                onChange={(e) => setQuantityInStock(e.target.value)}
                onBlur={(e) => setQuantityInStock(String(snapQuantityToUnit(Number(e.target.value) || 0, unit)))}
              />
            </Field>
          )}
          <Field label={`Low stock alert at${unit ? ` (${unitLabel(unit)})` : ''}`}>
            <input
              className={inputClass}
              type="number"
              step={quantityInputStep(unit)}
              min="0"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              onBlur={(e) => setLowStockThreshold(String(snapQuantityToUnit(Number(e.target.value) || 0, unit)))}
            />
          </Field>
        </div>
        {kind === 'finished' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Selling price (OMR)">
              <input className={inputClass} type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Cost per unit (OMR)">
              <input className={inputClass} type="number" step="0.001" min="0" value={finishedGoodCost} onChange={(e) => setFinishedGoodCost(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Cost per unit (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        )}
        {kind === 'finished' && (
          <p className="text-xs text-muted -mt-1">
            Cost per unit auto-updates (weighted average) whenever a Production Order completes for this product.
          </p>
        )}
        {kind === 'raw' && (
          <div className="grid grid-cols-1 gap-3 border-t border-black/10 pt-3 sm:grid-cols-2">
            <Field label="Preferred supplier (optional)">
              <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— None —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Reorder quantity${unit ? ` (${unitLabel(unit)})` : ''} (optional)`}>
              <input
                className={inputClass}
                type="number"
                step={quantityInputStep(unit)}
                min="0"
                placeholder="Auto-suggested if blank"
                value={reorderQuantity}
                onChange={(e) => setReorderQuantity(e.target.value)}
                onBlur={(e) =>
                  setReorderQuantity(e.target.value === '' ? '' : String(snapQuantityToUnit(Number(e.target.value) || 0, unit)))
                }
              />
            </Field>
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

function StockItemDetailModal({
  item,
  kind,
  supplierName,
  onClose,
}: {
  item: StockItem;
  kind: 'finished' | 'raw';
  supplierName?: string;
  onClose: () => void;
}) {
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">SKU</span>
          <span className="font-medium text-ink text-right">{item.sku || '-'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Barcode</span>
          <span className="font-medium text-ink text-right">{item.barcode || '-'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Unit</span>
          <span className="font-medium text-ink text-right">{unitLabel(item.unit)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">In stock</span>
          <span className="font-medium text-ink text-right">{formatQuantityWithUnit(item.quantityInStock, item.unit)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Low stock alert at</span>
          <span className="font-medium text-ink text-right">{formatQuantityWithUnit(item.lowStockThreshold, item.unit)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">{kind === 'finished' ? 'Selling price' : 'Cost per unit'}</span>
          <span className="font-medium text-ink text-right">
            {Number(kind === 'finished' ? item.sellingPrice : item.costPerUnit || 0).toFixed(3)} OMR
          </span>
        </div>
        {kind === 'raw' && (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Preferred supplier</span>
              <span className="font-medium text-ink text-right">{supplierName || '-'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Reorder quantity</span>
              <span className="font-medium text-ink text-right">
                {item.reorderQuantity !== undefined && item.reorderQuantity !== null && item.reorderQuantity !== ''
                  ? formatQuantityWithUnit(item.reorderQuantity, item.unit)
                  : 'Auto-suggested'}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end pt-4">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

function ScanStockModal({
  finishedGoods,
  onClose,
  onSaved,
}: {
  finishedGoods: StockItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  // The scanned product decides the unit (whole numbers for Pcs/Bags, up
  // to 3 decimals for Kgs/Litre/Tons).
  const scanned = finishedGoods.find((f) => f.barcode && f.barcode === barcode.trim());
  const unit = scanned?.unit;
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = direction === 'in' ? '/finished-goods/stock-in' : '/finished-goods/stock-out';
      await api.post(endpoint, { barcode, quantity: Number(quantity) });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not find that barcode.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Scan stock" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="mb-1">
          <Pill
            value={direction}
            onChange={(v) => setDirection(v as any)}
            options={[
              { value: 'in', label: 'Stock in' },
              { value: 'out', label: 'Stock out' },
            ]}
          />
        </div>
        <Field label="Barcode">
          <input
            className={inputClass}
            autoFocus
            value={barcode}
            onChange={(e) => {
              setBarcode(e.target.value);
              const match = finishedGoods.find((f) => f.barcode && f.barcode === e.target.value.trim());
              if (match) setQuantity((q) => String(snapQuantityToUnit(Number(q) || 0, match.unit) || 1));
            }}
            required
          />
          {scanned && (
            <p className="mt-1 text-xs text-muted">
              {scanned.name} · in stock {formatQuantityWithUnit(scanned.quantityInStock, scanned.unit)}
            </p>
          )}
        </Field>
        <Field label={`Quantity${scanned ? ` (${unitLabel(unit)})` : ''}`}>
          <input
            className={inputClass}
            type="number"
            step={quantityInputStep(unit)}
            min={quantityInputMin(unit)}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={(e) => setQuantity(String(snapQuantityToUnit(Number(e.target.value) || 0, unit)))}
            required
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Direct, batch-tracked "Add stock" — picks the product/material from a
// dropdown (no barcode needed) and creates a traceable batch. For Finished
// Goods this reuses the same /finished-goods/stock-in endpoint as Scan
// stock (every finished good has a required barcode, so it's looked up
// automatically). For Raw Materials this is the ONLY direct stock-in path
// — there's no Scan stock equivalent, since raw materials only otherwise
// gain stock via a Purchase Order receive.
function AddStockModal({
  kind,
  items,
  onClose,
  onSaved,
}: {
  kind: 'finished' | 'raw';
  items: StockItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  const [quantity, setQuantity] = useState('1');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = items.find((i) => i.id === itemId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (kind === 'finished') {
        const item = items.find((i) => i.id === itemId);
        await api.post('/finished-goods/stock-in', { barcode: item?.barcode, quantity: Number(quantity) });
      } else {
        await api.post(`/raw-materials/${itemId}/add-stock`, {
          quantity: Number(quantity),
          costPerUnit: costPerUnit ? Number(costPerUnit) : undefined,
          notes: notes || undefined,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not add stock.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add stock — ${kind === 'finished' ? 'Finished Good' : 'Raw Material'}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={kind === 'finished' ? 'Product' : 'Raw material'}>
          <select
            className={inputClass}
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              const next = items.find((i) => i.id === e.target.value);
              setQuantity((q) => String(snapQuantityToUnit(Number(q) || 0, next?.unit) || 1));
            }}
            required
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity to add${selected ? ` (${unitLabel(selected.unit)})` : ''}`}>
          <input
            className={inputClass}
            type="number"
            step={quantityInputStep(selected?.unit)}
            min={quantityInputMin(selected?.unit)}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={(e) => setQuantity(String(snapQuantityToUnit(Number(e.target.value) || 0, selected?.unit)))}
            required
          />
        </Field>
        {kind === 'raw' && (
          <>
            <Field label={`Cost per unit (OMR) — leave blank to keep current cost`}>
              <input
                className={inputClass}
                type="number"
                step="0.001"
                min="0"
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
                placeholder={selected ? Number(selected.costPerUnit || 0).toFixed(3) : '0.000'}
              />
            </Field>
            <Field label="Reason (optional)">
              <input
                className={inputClass}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Opening stock, stock count correction"
              />
            </Field>
            <p className="text-xs text-muted -mt-1">
              Creates a traceable batch and updates the average cost per unit if a different cost is entered.
            </p>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Add stock'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function NewProductionOrderModal({
  order,
  finishedGoods,
  onClose,
  onSaved,
}: {
  order?: ProductionOrder;
  finishedGoods: StockItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [finishedGoodId, setFinishedGoodId] = useState(order?.finishedGoodId || finishedGoods[0]?.id || '');
  const [quantity, setQuantity] = useState(
    order ? quantityInputValue(order.quantityToProduce, finishedGoods.find((f) => f.id === order.finishedGoodId)?.unit) : '1',
  );
  const [notes, setNotes] = useState(order?.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedFinishedGood = finishedGoods.find((f) => f.id === finishedGoodId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      finishedGoodId,
      quantityToProduce: Number(quantity),
      notes: notes || undefined,
    };
    try {
      if (order) await api.patch(`/production-orders/${order.id}`, payload);
      else await api.post('/production-orders', payload);
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || `Could not ${order ? 'update' : 'create'} the order.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={order ? 'Edit production order' : 'New production order'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Finished good">
          <select
            className={inputClass}
            value={finishedGoodId}
            onChange={(e) => {
              setFinishedGoodId(e.target.value);
              const next = finishedGoods.find((f) => f.id === e.target.value);
              setQuantity((q) => String(snapQuantityToUnit(Number(q) || 0, next?.unit) || 1));
            }}
            required
          >
            {finishedGoods.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity to produce${selectedFinishedGood ? ` (${unitLabel(selectedFinishedGood.unit)})` : ''}`}>
          <input
            className={inputClass}
            type="number"
            step={quantityInputStep(selectedFinishedGood?.unit)}
            min={quantityInputMin(selectedFinishedGood?.unit)}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={(e) => setQuantity(String(snapQuantityToUnit(Number(e.target.value) || 0, selectedFinishedGood?.unit)))}
            required
          />
        </Field>
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

// Read-only detail — the order itself plus the recipe (BOM) it will
// consume/consumed, so you can see what a run needs without switching tabs.
function ProductionOrderDetailModal({
  order,
  finishedGoodName,
  finishedGoodUnit,
  rmName,
  rmUnit,
  onClose,
}: {
  order: ProductionOrder;
  finishedGoodName: string;
  finishedGoodUnit?: string;
  rmName: (id: string) => string;
  rmUnit: (id: string) => string | undefined;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<BomLine[] | null>(null);

  useEffect(() => {
    api.get(`/bom/finished-good/${order.finishedGoodId}`).then((res) => setLines(res.data));
  }, [order.finishedGoodId]);

  return (
    <Modal title="Production order" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm space-y-1.5">
          <div className="flex justify-between gap-3">
            <span className="text-muted">Finished good</span>
            <span className="font-medium text-ink text-right">{finishedGoodName}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Quantity to produce</span>
            <span className="font-medium text-ink text-right">
              {formatQuantityWithUnit(order.quantityToProduce, finishedGoodUnit)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Status</span>
            <span className="font-medium text-ink text-right">{order.status}</span>
          </div>
          {order.notes && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Notes</span>
              <span className="font-medium text-ink text-right">{order.notes}</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Recipe — {formatQuantityWithUnit(order.quantityToProduce, finishedGoodUnit)} needs
          </div>
          {!lines ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : lines.length === 0 ? (
            <div className="text-sm text-muted">No recipe defined for this product yet.</div>
          ) : (
            <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
              {lines.map((line) => (
                <div key={line.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0">{rmName(line.rawMaterialId)}</span>
                  <span className="text-muted">
                    {formatDerivedQuantity(Number(line.quantityPerUnit) * Number(order.quantityToProduce), rmUnit(line.rawMaterialId))} total (
                    {formatRatio(line.quantityPerUnit)} {unitLabel(rmUnit(line.rawMaterialId))} per {unitLabel(finishedGoodUnit)})
                  </span>
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

function BomLineModal({
  line,
  finishedGoodId,
  finishedGoodUnit,
  rawMaterials,
  onClose,
  onSaved,
}: {
  line?: BomLine;
  finishedGoodId: string;
  finishedGoodUnit?: string;
  rawMaterials: StockItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rawMaterialId, setRawMaterialId] = useState(line?.rawMaterialId || rawMaterials[0]?.id || '');
  // A ratio (raw material per 1 unit of finished good), so decimals are
  // allowed whatever the units are — e.g. 0.25 Kgs per Bag.
  const [quantityPerUnit, setQuantityPerUnit] = useState(line ? formatRatio(line.quantityPerUnit) : '0.1');
  const selectedMaterial = rawMaterials.find((r) => r.id === rawMaterialId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (line) {
        await api.patch(`/bom/${line.id}`, { rawMaterialId, quantityPerUnit: Number(quantityPerUnit) });
      } else {
        await api.post('/bom', { finishedGoodId, rawMaterialId, quantityPerUnit: Number(quantityPerUnit) });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || `Could not ${line ? 'update' : 'add'} this ingredient.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={line ? 'Edit ingredient' : 'Add ingredient to recipe'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Raw material">
          <select className={inputClass} value={rawMaterialId} onChange={(e) => setRawMaterialId(e.target.value)} required>
            {rawMaterials.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Quantity per unit produced${selectedMaterial ? ` (${unitLabel(selectedMaterial.unit)} per 1 ${unitLabel(finishedGoodUnit)})` : ''}`}
        >
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              type="number"
              step="0.0001"
              min="0.0001"
              value={quantityPerUnit}
              onChange={(e) => setQuantityPerUnit(e.target.value)}
              required
            />
            {selectedMaterial && <span className="shrink-0 text-sm text-muted">{unitLabel(selectedMaterial.unit)}</span>}
          </div>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Forward trace: this raw material batch -> which production runs
// consumed it -> which finished good batches those runs produced -> which
// customers (via sales orders) those finished good batches were sold to.
function RawBatchTraceModal({
  batch,
  rawMaterialName,
  rawMaterialUnit,
  finishedGoodUnit,
  supplierName,
  finishedGoodName,
  customerNameForOrder,
  onClose,
}: {
  batch: RawMaterialBatch;
  rawMaterialName: string;
  rawMaterialUnit?: string;
  finishedGoodUnit: (id: string) => string | undefined;
  supplierName: string | null;
  finishedGoodName: (id: string) => string;
  customerNameForOrder: (salesOrderId?: string, invoiceId?: string | null) => string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [consumptions, setConsumptions] = useState<ProductionBatchConsumption[]>([]);
  const [finishedGoodBatches, setFinishedGoodBatches] = useState<FinishedGoodBatch[]>([]);
  const [salesConsumptions, setSalesConsumptions] = useState<SalesBatchConsumption[]>([]);

  useEffect(() => {
    api
      .get(`/raw-material-batches/${batch.id}/trace-forward`)
      .then((res) => {
        setConsumptions(res.data.consumptions);
        setFinishedGoodBatches(res.data.finishedGoodBatches);
        setSalesConsumptions(res.data.salesConsumptions);
      })
      .finally(() => setLoading(false));
  }, [batch.id]);

  function fgBatch(id: string) {
    return finishedGoodBatches.find((b) => b.id === id);
  }

  return (
    <Modal title={`Trace forward — ${batch.batchNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          <div className="font-medium text-ink">{rawMaterialName}</div>
          <div className="text-xs text-muted mt-0.5">
            Received {formatQuantityWithUnit(batch.quantityReceived, rawMaterialUnit)} on {batch.receivedDate}
            {supplierName && ` from ${supplierName}`} · cost {Number(batch.costPerUnit).toFixed(3)} OMR/{unitLabel(rawMaterialUnit)}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : consumptions.length === 0 ? (
          <EmptyState>Not used in any production run yet.</EmptyState>
        ) : (
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Used in production</div>
            <div className="space-y-2">
              {consumptions.map((c) => {
                const fb = fgBatch(c.finishedGoodBatchId);
                const sales = salesConsumptions.filter((s) => s.finishedGoodBatchId === c.finishedGoodBatchId);
                return (
                  <Card key={c.id} className="p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm font-medium text-ink min-w-0">
                        {formatDerivedQuantity(c.quantityConsumed, rawMaterialUnit)} used → {fb ? `${fb.batchNumber} (${finishedGoodName(fb.finishedGoodId)})` : 'finished good batch'}
                      </div>
                      {fb && (
                        <span className="text-xs text-muted">
                          {formatQuantity(fb.quantityRemaining, finishedGoodUnit(fb.finishedGoodId))} /{' '}
                          {formatQuantityWithUnit(fb.quantityProduced, finishedGoodUnit(fb.finishedGoodId))} remaining
                        </span>
                      )}
                    </div>
                    {sales.length > 0 && (
                      <div className="mt-2 pl-3 border-l-2 border-black/10 space-y-1">
                        {sales.map((s) => (
                          <div key={s.id} className="text-xs text-muted">
                            → {formatQuantityWithUnit(s.quantityConsumed, finishedGoodUnit(s.finishedGoodId))} sold to {customerNameForOrder(s.salesOrderId, s.invoiceId)}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Backward trace: this finished good batch -> which raw material batches
// (and suppliers) fed into it, plus which customers it was sold to.
function FinishedBatchTraceModal({
  batch,
  finishedGoodName,
  finishedGoodUnit,
  rawMaterialName,
  rawMaterialUnit,
  supplierName,
  customerNameForOrder,
  onClose,
}: {
  batch: FinishedGoodBatch;
  finishedGoodName: string;
  finishedGoodUnit?: string;
  rawMaterialName: (id: string) => string;
  rawMaterialUnit: (id: string) => string | undefined;
  supplierName: (id?: string) => string | null;
  customerNameForOrder: (salesOrderId?: string, invoiceId?: string | null) => string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [consumptions, setConsumptions] = useState<ProductionBatchConsumption[]>([]);
  const [rawMaterialBatches, setRawMaterialBatches] = useState<RawMaterialBatch[]>([]);
  const [sales, setSales] = useState<SalesBatchConsumption[]>([]);

  useEffect(() => {
    Promise.all([
      api.get(`/finished-good-batches/${batch.id}/trace-backward`),
      api.get(`/finished-good-batches/${batch.id}/sales`),
    ])
      .then(([backRes, salesRes]) => {
        setConsumptions(backRes.data.consumptions);
        setRawMaterialBatches(backRes.data.rawMaterialBatches);
        setSales(salesRes.data);
      })
      .finally(() => setLoading(false));
  }, [batch.id]);

  function rmBatch(id: string) {
    return rawMaterialBatches.find((b) => b.id === id);
  }

  return (
    <Modal title={`Trace back — ${batch.batchNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          <div className="font-medium text-ink">{finishedGoodName}</div>
          <div className="text-xs text-muted mt-0.5">
            Produced {formatQuantityWithUnit(batch.quantityProduced, finishedGoodUnit)} on {batch.producedDate}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : (
          <>
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Made from</div>
              {consumptions.length === 0 ? (
                <div className="text-sm text-muted">No raw material consumption recorded.</div>
              ) : (
                <div className="space-y-2">
                  {consumptions.map((c) => {
                    const rb = rmBatch(c.rawMaterialBatchId);
                    return (
                      <Card key={c.id} className="p-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-ink min-w-0">
                          {formatDerivedQuantity(c.quantityConsumed, rawMaterialUnit(c.rawMaterialId))} {rawMaterialName(c.rawMaterialId)}
                          {rb && <span className="text-muted"> — {rb.batchNumber}</span>}
                        </div>
                        {rb && supplierName(rb.supplierId) && (
                          <span className="text-xs text-muted">from {supplierName(rb.supplierId)}</span>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Sold to</div>
              {sales.length === 0 ? (
                <div className="text-sm text-muted">Not sold yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {sales.map((s) => (
                    <div key={s.id} className="text-sm text-ink">
                      {formatQuantityWithUnit(s.quantityConsumed, finishedGoodUnit)} → {customerNameForOrder(s.salesOrderId, s.invoiceId)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
