import { FormEvent, useEffect, useState } from 'react';
import { Plus, Landmark, Pencil, Trash2, RotateCcw, Zap } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import BankAccountSelect from '../components/BankAccountSelect';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass, StatCard } from '../components/ui';
import { localISODate } from '../utils/dates';

const CATEGORY_OPTIONS = [
  { value: 'machinery_equipment', label: 'Machinery & Equipment' },
  { value: 'furniture_fixtures', label: 'Furniture & Fixtures' },
  { value: 'vehicles', label: 'Vehicles' },
  { value: 'computer_office_equipment', label: 'Computer & Office Equipment' },
  { value: 'other', label: 'Other (Long-Term Asset)' },
];

function categoryLabel(v: string) {
  return CATEGORY_OPTIONS.find((c) => c.value === v)?.label || v;
}

interface FixedAsset {
  id: string;
  assetNumber: string;
  name: string;
  category: string;
  purchaseDate: string;
  cost: number | string;
  salvageValue: number | string;
  usefulLifeMonths: number;
  accumulatedDepreciation: number | string;
  lastDepreciationPeriod?: string;
  status: 'active' | 'disposed';
  disposalDate?: string;
  disposalProceeds?: number | string;
  disposalVat?: number | string;
  disposalBuyer?: string | null;
  bankAccountId?: string;
  vatAmount?: number | string;
  supplierId?: string;
  supplierInvoiceNumber?: string;
  purchaseOrderId?: string;
  notes?: string;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}

const statusTone: Record<string, string> = {
  active: 'bg-brand-50 text-brand-700',
  disposed: 'bg-black/5 text-ink/60',
};

function money(n: number | string) {
  return Number(n).toFixed(3);
}

// "Fixed Assets" tab inside Accounting — the PP&E register: registering an
// asset posts its cost to the Chart of Accounts immediately; after each
// month ends, straight-line depreciation for it posts automatically (dated
// the month's last day, first month pro-rata by days held) until the asset
// is fully depreciated or disposed. Dispose depreciates up to the disposal
// date first, then posts the gain/loss and any output VAT on a sale.
export default function FixedAssetsPanel() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editAsset, setEditAsset] = useState<FixedAsset | null>(null);
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/fixed-assets').then((res) => setAssets(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
  }, []);

  function bankAccountName(id?: string) {
    if (!id) return undefined;
    return bankAccounts.find((b) => b.id === id)?.name;
  }

  async function removeAsset(id: string) {
    if (!window.confirm('Delete this fixed asset? Only possible before any depreciation has posted. This cannot be undone.')) return;
    try {
      await api.delete(`/fixed-assets/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this asset.');
    }
  }

  async function depreciateNow(id: string) {
    setBusyId(id);
    try {
      await api.post(`/fixed-assets/${id}/depreciate`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not post depreciation for this asset.');
    } finally {
      setBusyId(null);
    }
  }

  const totalCost = assets.reduce((s, a) => s + Number(a.cost), 0);
  const totalAccumDep = assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0);
  const netBookValue = totalCost - totalAccumDep;

  return (
    <div>
      <PageHeader
        title="Fixed Assets"
        subtitle="Property, Plant & Equipment register — straight-line depreciation posts automatically after each month ends"
        action={canManage ? <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>Register asset</PrimaryButton> : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
        <StatCard icon={Landmark} label="Total Cost" value={`${money(totalCost)} OMR`} />
        <StatCard icon={Landmark} label="Accumulated Depreciation" value={`${money(totalAccumDep)} OMR`} />
        <StatCard icon={Landmark} label="Net Book Value" value={`${money(netBookValue)} OMR`} />
      </div>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : assets.length === 0 ? (
        <EmptyState>No fixed assets registered yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {assets.map((a) => {
              const nbv = Number(a.cost) - Number(a.accumulatedDepreciation);
              return (
                <div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{a.name}</div>
                    <div className="text-xs text-muted">
                      <span className="whitespace-nowrap">{a.assetNumber}</span> · {categoryLabel(a.category)} · Purchased {a.purchaseDate}
                      {bankAccountName(a.bankAccountId) ? ` · from ${bankAccountName(a.bankAccountId)}` : ''}
                      {!a.bankAccountId && a.purchaseOrderId ? ' · on credit (supplier bill)' : ''}
                      {Number(a.vatAmount || 0) > 0 ? ` · VAT ${money(a.vatAmount || 0)} OMR (inv ${a.supplierInvoiceNumber})` : ''}
                      {a.status === 'disposed' ? ` · Disposed ${a.disposalDate} (proceeds ${money(a.disposalProceeds || 0)} OMR${Number(a.disposalVat || 0) > 0 ? ` + VAT ${money(a.disposalVat || 0)}` : ''}${a.disposalBuyer ? `, sold to ${a.disposalBuyer}` : ''})` : ''}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Cost {money(a.cost)} OMR · Depreciated {money(a.accumulatedDepreciation)} OMR · NBV {money(nbv)} OMR
                      {a.status === 'active' && a.lastDepreciationPeriod ? ` · Depreciated through ${a.lastDepreciationPeriod}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusTone[a.status]}`}>{a.status}</span>
                    {canManage && a.status === 'active' && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <IconButton icon={Zap} requires="edit" title={busyId === a.id ? 'Posting…' : 'Post depreciation for months that have ended'} onClick={() => (busyId === a.id ? undefined : depreciateNow(a.id))} />
                        <IconButton icon={Pencil} requires="edit" title="Edit" onClick={() => setEditAsset(a)} />
                        <IconButton icon={RotateCcw} requires="edit" title="Dispose" onClick={() => setDisposingAsset(a)} />
                        {Number(a.accumulatedDepreciation) === 0 && (
                          <IconButton icon={Trash2} tone="danger" requires="full" title="Delete" onClick={() => removeAsset(a.id)} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showAdd && (
        <AssetModal
          bankAccounts={bankAccounts}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editAsset && (
        <AssetModal
          asset={editAsset}
          bankAccounts={bankAccounts}
          onClose={() => setEditAsset(null)}
          onSaved={() => {
            setEditAsset(null);
            load();
          }}
        />
      )}
      {disposingAsset && (
        <DisposeModal
          asset={disposingAsset}
          bankAccounts={bankAccounts}
          onClose={() => setDisposingAsset(null)}
          onSaved={() => {
            setDisposingAsset(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AssetModal({
  asset,
  bankAccounts,
  onClose,
  onSaved,
}: {
  asset?: FixedAsset;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!asset;
  const [name, setName] = useState(asset?.name || '');
  const [category, setCategory] = useState(asset?.category || CATEGORY_OPTIONS[0].value);
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate || localISODate());
  const [cost, setCost] = useState(asset ? String(asset.cost) : '0');
  const [salvageValue, setSalvageValue] = useState(asset ? String(asset.salvageValue) : '0');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState(asset ? String(asset.usefulLifeMonths) : '36');
  const [bankAccountId, setBankAccountId] = useState(asset?.bankAccountId || '');
  const [payMode, setPayMode] = useState<'paid' | 'credit'>('paid');
  const [vatAmount, setVatAmount] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [notes, setNotes] = useState(asset?.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    api
      .get('/suppliers')
      .then((res) => setSuppliers(res.data))
      .catch(() => setSuppliers([]));
  }, [isEdit]);

  const vatNum = Number(vatAmount || 0);
  const needsSupplier = payMode === 'credit' || vatNum > 0;
  const gross = Number(cost || 0) + vatNum;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.patch(`/fixed-assets/${asset!.id}`, {
          name,
          salvageValue: Number(salvageValue),
          usefulLifeMonths: Number(usefulLifeMonths),
          notes: notes || undefined,
        });
      } else {
        await api.post('/fixed-assets', {
          name,
          category,
          purchaseDate,
          cost: Number(cost),
          salvageValue: Number(salvageValue),
          usefulLifeMonths: Number(usefulLifeMonths),
          bankAccountId: payMode === 'paid' ? bankAccountId || undefined : undefined,
          vatAmount: vatNum > 0 ? vatNum : undefined,
          supplierId: supplierId || undefined,
          supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
          notes: notes || undefined,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit fixed asset' : 'Register fixed asset'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Asset name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} disabled={isEdit}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Purchase date">
            <input className={inputClass} type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required disabled={isEdit} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isEdit ? 'Cost (OMR)' : 'Cost excl. VAT (OMR)'}>
            <input className={inputClass} type="number" step="0.001" min="0.001" value={cost} onChange={(e) => setCost(e.target.value)} required disabled={isEdit} />
          </Field>
          <Field label="Salvage value (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} required />
          </Field>
        </div>
        <Field label="Useful life (months)">
          <input className={inputClass} type="number" step="1" min="1" value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} required />
        </Field>
        {!isEdit && (
          <>
            <Field label="VAT on the supplier's tax invoice (OMR)">
              <input className={inputClass} type="number" step="0.001" min="0" value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} />
              <span className="mt-1 block text-xs text-muted">Claimed as input VAT. Leave 0 if there is no tax invoice (then put the VAT in the cost).</span>
            </Field>
            <Field label="Payment">
              <select className={inputClass} value={payMode} onChange={(e) => setPayMode(e.target.value as 'paid' | 'credit')}>
                <option value="paid">Paid now from a bank / cash account</option>
                <option value="credit">On credit - creates a supplier bill</option>
              </select>
            </Field>
            {payMode === 'paid' && (
              <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts} />
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={needsSupplier ? 'Supplier' : 'Supplier (optional)'}>
                <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required={needsSupplier}>
                  <option value="">Choose supplier</option>
                  {suppliers.map((sp) => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={vatNum > 0 ? 'Supplier invoice no.' : 'Supplier invoice no. (optional)'}>
                <input className={inputClass} value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} required={vatNum > 0} />
              </Field>
            </div>
            <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
              Total {payMode === 'paid' ? 'paid' : 'owed to the supplier'}: {money(gross)} OMR
              {vatNum > 0 ? ` (cost ${money(Number(cost || 0))} + VAT ${money(vatNum)})` : ''}
            </div>
          </>
        )}
        <Field label="Notes (optional)">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {isEdit && (
          <p className="text-xs text-muted">
            Category, cost, VAT, purchase date, supplier and payment can't be changed after registering — this keeps the posted purchase entry consistent. Delete and re-register instead if these were entered wrong (only possible before any depreciation has posted).
          </p>
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

function DisposeModal({
  asset,
  bankAccounts,
  onClose,
  onSaved,
}: {
  asset: FixedAsset;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [disposalDate, setDisposalDate] = useState(localISODate());
  const [disposalProceeds, setDisposalProceeds] = useState('0');
  const [bankAccountId, setBankAccountId] = useState('');
  const [chargeVat, setChargeVat] = useState(false);
  const [buyer, setBuyer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const nbv = Number(asset.cost) - Number(asset.accumulatedDepreciation);
  const proceeds = Number(disposalProceeds) || 0;
  const vat = chargeVat && proceeds > 0 ? Math.round(proceeds * 0.05 * 1000) / 1000 : 0;

  useEffect(() => {
    // a VAT-registered company charges 5% VAT when it sells a business asset
    api.get('/settings').then((r) => setChargeVat(!!String(r.data?.companyVatin || '').trim())).catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/fixed-assets/${asset.id}/dispose`, {
        disposalDate,
        disposalProceeds: proceeds,
        vatAmount: vat || undefined,
        buyer: proceeds > 0 && buyer.trim() ? buyer.trim() : undefined,
        bankAccountId: proceeds > 0 ? bankAccountId || undefined : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not dispose this asset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Dispose — ${asset.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
          Net book value: {money(nbv)} OMR (cost {money(asset.cost)} − accumulated depreciation {money(asset.accumulatedDepreciation)}).
          Depreciation for the months not posted yet, up to the disposal date, is posted first.
        </div>
        <Field label="Disposal date">
          <input className={inputClass} type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} required />
        </Field>
        <Field label="Sale price excl. VAT (OMR) — 0 if scrapped with no sale">
          <input className={inputClass} type="number" step="0.001" min="0" value={disposalProceeds} onChange={(e) => setDisposalProceeds(e.target.value)} required />
        </Field>
        {proceeds > 0 && (
          <>
            <Field label="Buyer (optional)">
              <input className={inputClass} value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={200} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={chargeVat} onChange={(e) => setChargeVat(e.target.checked)} />
              Charge 5% VAT to the buyer ({money(vat)} OMR — goes on the VAT return)
            </label>
            <div className="text-xs text-muted">Money received: {money(proceeds + vat)} OMR</div>
          </>
        )}
        {proceeds > 0 && (
          <Field label="Deposit proceeds into">
            <select className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
              <option value="">Select account…</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({money(b.currentBalance)} OMR)</option>
              ))}
            </select>
          </Field>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Disposing…' : 'Confirm disposal'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
