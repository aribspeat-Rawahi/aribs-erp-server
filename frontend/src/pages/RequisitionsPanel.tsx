import { FormEvent, useEffect, useState } from 'react';
import { Eye, FileQuestion, Pencil, Plus, ShoppingCart } from 'lucide-react';
import api from '../api/client';
import { Card, EmptyState, Field, IconButton, Modal, PrimaryButton, SecondaryButton, inputClass } from '../components/ui';
import { ApprovalBand, ApprovalHistory, ApprovalStepView, approvalLine, bandFor, describeSteps } from '../components/approvalInfo';
import { formatQuantityWithUnit, normalizeUnit, quantityInputMin, quantityInputStep, quantityInputValue, unitLabel } from '../utils/formatQuantity';
import type { PoDraft } from './Suppliers';

interface RawMaterial {
  id: string;
  name: string;
  unit?: string;
  costPerUnit?: number | string;
}
interface RequisitionLine {
  id: string;
  rawMaterialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  estimatedUnitCost: number;
  note?: string | null;
  orderedQuantity: number;
  remainingQuantity: number;
}
interface Requisition {
  id: string;
  prNumber: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'closed';
  purpose: string;
  department?: string | null;
  neededBy?: string | null;
  estimatedTotal: number;
  requestedByEmail?: string | null;
  createdAt: string;
  items: RequisitionLine[];
  fullyOrdered: boolean;
  purchaseOrders: { id: string; poNumber: string; status: string; total: number }[];
  rfqs: { id: string; rfqNumber: string; status: string }[];
  approvalPending?: ApprovalStepView | null;
  lastDecision?: ApprovalStepView | null;
  approvalHistory?: ApprovalStepView[];
}

const STATUS: Record<string, { label: string; tone: string }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'bg-purple-50 text-purple-700' },
  approved: { label: 'Approved', tone: 'bg-brand-50 text-brand-700' },
  rejected: { label: 'Rejected', tone: 'bg-red-50 text-red-600' },
  cancelled: { label: 'Cancelled', tone: 'bg-black/5 text-ink/60' },
  closed: { label: 'Closed', tone: 'bg-black/5 text-ink/60' },
};

const money = (n: number | string) => Number(n || 0).toFixed(3);
// the item's last cost as a plain number ("2", not "2.000000")
const costText = (c?: number | string) => (c === undefined || c === null || c === '' ? '' : String(Number(c)));

// Suppliers > Requisitions: request -> approval -> purchase order(s) or RFQ.
export default function RequisitionsPanel({
  rawMaterials,
  onCreatePo,
  onCreateRfq,
}: {
  rawMaterials: RawMaterial[];
  onCreatePo: (draft: PoDraft) => void;
  onCreateRfq: () => void;
}) {
  const [rows, setRows] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Requisition | 'new' | null>(null);
  const [viewing, setViewing] = useState<Requisition | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/purchase-requisitions').then((r) => setRows(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function act(pr: Requisition, action: 'resubmit' | 'cancel' | 'close') {
    const q = {
      resubmit: 'Send this requisition for approval again, unchanged?',
      cancel: 'Cancel this requisition? It will not be ordered.',
      close: 'Close this requisition? Nothing more will be ordered on it.',
    }[action];
    if (!window.confirm(q)) return;
    setBusyId(pr.id);
    try {
      await api.post(`/purchase-requisitions/${pr.id}/${action}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not do that.');
    } finally {
      setBusyId(null);
    }
  }

  async function getQuotes(pr: Requisition) {
    setBusyId(pr.id);
    try {
      await api.post('/rfqs', { requisitionId: pr.id });
      onCreateRfq();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not start the RFQ.');
    } finally {
      setBusyId(null);
    }
  }

  function order(pr: Requisition) {
    onCreatePo({
      supplierId: '',
      requisitionId: pr.id,
      notes: `For ${pr.prNumber} - ${pr.purpose}`.slice(0, 250),
      items: pr.items
        .filter((i) => i.remainingQuantity > 0.0005)
        .map((i) => ({
          rawMaterialId: i.rawMaterialId,
          quantity: quantityInputValue(i.remainingQuantity, i.unit),
          costPerUnit: String(i.estimatedUnitCost || 0),
          requisitionItemId: i.id,
        })),
    });
  }

  async function view(pr: Requisition) {
    const r = await api.get(`/purchase-requisitions/${pr.id}`);
    setViewing(r.data);
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <PrimaryButton icon={Plus} requires="edit" onClick={() => setEditing('new')}>New requisition</PrimaryButton>
      </div>
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState>No purchase requisitions yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {rows.map((pr) => {
              const st = STATUS[pr.status] || { label: pr.status, tone: 'bg-black/5 text-ink/70' };
              const approval = approvalLine(pr.approvalPending, pr.lastDecision, pr.status);
              const canOrder = pr.status === 'approved' && !pr.fullyOrdered;
              const busy = busyId === pr.id;
              return (
                <div key={pr.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-ink whitespace-nowrap">{pr.prNumber}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.tone}`}>{st.label}</span>
                      {pr.status === 'approved' && pr.fullyOrdered && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-sky-50 text-sky-700">Fully ordered</span>
                      )}
                    </div>
                    <div className="text-sm text-ink/80">{pr.purpose}</div>
                    <div className="text-xs text-muted">
                      {pr.items.map((i) => `${i.materialName} ${formatQuantityWithUnit(i.quantity, i.unit)}${i.orderedQuantity > 0 ? ` (${formatQuantityWithUnit(i.orderedQuantity, i.unit)} ordered)` : ''}`).join(' · ')}
                    </div>
                    <div className="text-xs text-muted">
                      about {money(pr.estimatedTotal)} OMR
                      {pr.department ? ` · ${pr.department}` : ''}
                      {pr.neededBy ? ` · needed by ${pr.neededBy}` : ''}
                      {pr.requestedByEmail ? ` · by ${pr.requestedByEmail}` : ''}
                    </div>
                    {approval && <div className={`text-xs ${approval.tone}`}>{approval.text}</div>}
                    {(pr.purchaseOrders.length > 0 || pr.rfqs.length > 0) && (
                      <div className="text-xs text-muted">
                        {[...pr.rfqs.map((q) => `${q.rfqNumber} (${q.status})`), ...pr.purchaseOrders.map((o) => `${o.poNumber} (${o.status.replace('_', ' ')})`)].join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {canOrder && (
                      <>
                        <SecondaryButton icon={ShoppingCart} requires="edit" disabled={busy} onClick={() => order(pr)}>Create PO</SecondaryButton>
                        <SecondaryButton icon={FileQuestion} requires="edit" disabled={busy} onClick={() => getQuotes(pr)}>Get quotes</SecondaryButton>
                      </>
                    )}
                    {pr.status === 'rejected' && <SecondaryButton requires="edit" disabled={busy} onClick={() => act(pr, 'resubmit')}>Send again</SecondaryButton>}
                    {pr.status === 'approved' && pr.purchaseOrders.some((o) => !['cancelled', 'rejected'].includes(o.status)) && (
                      <SecondaryButton requires="edit" disabled={busy} onClick={() => act(pr, 'close')}>Close</SecondaryButton>
                    )}
                    {['pending_approval', 'rejected', 'approved'].includes(pr.status) && !pr.purchaseOrders.some((o) => !['cancelled', 'rejected'].includes(o.status)) && (
                      <SecondaryButton requires="edit" disabled={busy} onClick={() => act(pr, 'cancel')}>Cancel</SecondaryButton>
                    )}
                    <div className="flex items-center gap-1.5">
                      <IconButton icon={Eye} title="View" onClick={() => view(pr)} />
                      {(pr.status === 'pending_approval' || pr.status === 'rejected') && <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditing(pr)} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {editing && (
        <RequisitionModal
          requisition={editing === 'new' ? null : editing}
          rawMaterials={rawMaterials}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {viewing && (
        <Modal title={`${viewing.prNumber} — ${STATUS[viewing.status]?.label || viewing.status}`} onClose={() => setViewing(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><span className="text-muted">Purpose:</span> {viewing.purpose}</div>
              <div><span className="text-muted">Department:</span> {viewing.department || '-'}</div>
              <div><span className="text-muted">Needed by:</span> {viewing.neededBy || '-'}</div>
              <div><span className="text-muted">Requested by:</span> {viewing.requestedByEmail || '-'}</div>
              <div><span className="text-muted">Estimate:</span> {money(viewing.estimatedTotal)} OMR</div>
            </div>
            <div className="border border-black/10 rounded-lg overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-black/5 text-xs text-muted">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Requested</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Left</th>
                    <th className="text-right px-3 py-2">Est. cost/unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {viewing.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2">{i.materialName}{i.note ? <div className="text-xs text-muted">{i.note}</div> : null}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(i.quantity, i.unit)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(i.orderedQuantity, i.unit)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantityWithUnit(i.remainingQuantity, i.unit)}</td>
                      <td className="px-3 py-2 text-right">{money(i.estimatedUnitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ApprovalHistory rows={viewing.approvalHistory} />
            <div className="flex justify-end">
              <SecondaryButton onClick={() => setViewing(null)}>Close</SecondaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RequisitionModal({
  requisition,
  rawMaterials,
  onClose,
  onSaved,
}: {
  requisition: Requisition | null;
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const unitOf = (id: string) => normalizeUnit(rawMaterials.find((m) => m.id === id)?.unit);
  const [purpose, setPurpose] = useState(requisition?.purpose || '');
  const [department, setDepartment] = useState(requisition?.department || '');
  const [neededBy, setNeededBy] = useState(requisition?.neededBy || '');
  const [items, setItems] = useState(
    requisition
      ? requisition.items.map((i) => ({ key: i.id, rawMaterialId: i.rawMaterialId, quantity: quantityInputValue(i.quantity, i.unit), cost: String(i.estimatedUnitCost || ''), note: i.note || '' }))
      : [{ key: 'n0', rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', cost: costText(rawMaterials[0]?.costPerUnit), note: '' }],
  );
  const [rules, setRules] = useState<ApprovalBand[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/approval-rules').then((r) => setRules(r.data.purchase_requisition)).catch(() => undefined);
  }, []);
  const estimate = items.reduce((t, i) => t + Math.round(Number(i.quantity || 0) * Number(i.cost || 0) * 1000) / 1000, 0);
  const band = bandFor(rules, estimate);

  function update(idx: number, patch: Partial<(typeof items)[number]>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const payload = {
      purpose,
      department: department || undefined,
      neededBy: neededBy || undefined,
      items: items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: Number(i.quantity), estimatedUnitCost: Number(i.cost || 0), note: i.note || undefined })),
    };
    try {
      if (requisition) await api.patch(`/purchase-requisitions/${requisition.id}`, payload);
      else await api.post('/purchase-requisitions', payload);
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save the requisition.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={requisition ? `Edit ${requisition.prNumber}` : 'New purchase requisition'} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="What is it for?">
          <input className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Raw material for the hotel mattress order" required minLength={3} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Department (optional)">
            <input className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Needed by (optional)">
            <input className={inputClass} type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_100px_64px_110px_1fr] gap-2 text-xs text-muted">
            <span>Item</span><span>Qty</span><span>Unit</span><span>Est. cost/unit</span><span>Note</span>
          </div>
          {items.map((it, i) => {
            const unit = unitOf(it.rawMaterialId);
            return (
              <div key={it.key} className="grid grid-cols-[1fr_64px_1fr] gap-2 items-center sm:grid-cols-[1fr_100px_64px_110px_1fr]">
                <select
                  className={`${inputClass} col-span-3 sm:col-span-1`}
                  value={it.rawMaterialId}
                  onChange={(e) => update(i, { rawMaterialId: e.target.value, cost: it.cost || costText(rawMaterials.find((m) => m.id === e.target.value)?.costPerUnit) })}
                >
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {/* phone: the column names between the item and its numbers */}
                {i === 0 && (
                  <div className="col-span-3 -mb-1 grid grid-cols-[1fr_64px_1fr] gap-2 text-xs text-muted sm:hidden">
                    <span>Qty</span><span>Unit</span><span>Est. cost/unit</span>
                  </div>
                )}
                <input className={inputClass} type="number" step={quantityInputStep(unit)} min={quantityInputMin(unit)} value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} required title="Quantity" />
                <div className="h-full flex items-center justify-center rounded-lg bg-black/5 px-2 text-sm text-ink/70">{unitLabel(unit)}</div>
                <input className={inputClass} type="number" step="0.001" min="0" placeholder="Est. cost" value={it.cost} onChange={(e) => update(i, { cost: e.target.value })} />
                <div className="col-span-3 flex gap-2 sm:col-span-1">
                  <input className={inputClass} placeholder="Note (optional)" value={it.note} onChange={(e) => update(i, { note: e.target.value })} maxLength={255} />
                  {items.length > 1 && (
                    <button type="button" className="text-muted hover:text-red-600 px-1" title="Remove line" onClick={() => setItems((p) => p.filter((_, x) => x !== i))}>
                      &times;
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <SecondaryButton onClick={() => setItems((p) => [...p, { key: `n${Date.now()}`, rawMaterialId: rawMaterials[0]?.id || '', quantity: '1', cost: costText(rawMaterials[0]?.costPerUnit), note: '' }])}>
            + Add item
          </SecondaryButton>
        </div>
        <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-ink/80">
          Estimate <span className="font-semibold">{estimate.toFixed(3)} OMR</span>
          {rules === undefined ? '' : band ? ` · approved by ${describeSteps(band.steps)}` : ' · no approval needed'}
          {requisition ? ' · saving sends it for approval again' : ''}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : band ? 'Send for approval' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
