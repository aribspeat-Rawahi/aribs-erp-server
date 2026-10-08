import { FormEvent, useEffect, useState } from 'react';
import { Plus, Percent, Receipt, Pencil, Trash2, Eye, Upload } from 'lucide-react';
import BankAccountSelect from '../components/BankAccountSelect';
import api from '../api/client';
import VatReturnsPanel from './VatReturnsPanel';
import { viewFile } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, SecondaryButton, IconButton, Pill, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { localISODate } from '../utils/dates';

interface TaxRate {
  id: string;
  name: string;
  rate: number | string;
  description?: string;
  active: boolean;
}

interface BankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}

interface TaxPayment {
  id: string;
  paymentNumber: string;
  period: string;
  amount: number | string;
  datePaid: string;
  reference?: string;
  note?: string;
  documentFilePath?: string;
  bankAccountId?: string;
}

type TaxTab = 'vat' | 'rates' | 'payments';

// "Tax" tab inside Accounting — Tax Rates (a reference list, not yet
// applied automatically anywhere) and Tax Payments (a record of VAT
// actually paid to/refunded by the tax authority, optionally synced to a
// bank/cash account). Built ahead of the auto-posting double-entry work,
// which will later read these rates when generating Journal Entries.
export default function TaxPanel() {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const [subTab, setSubTab] = useState<TaxTab>('vat');

  const [rates, setRates] = useState<TaxRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [showAddRate, setShowAddRate] = useState(false);
  const [editRate, setEditRate] = useState<TaxRate | null>(null);

  const [payments, setPayments] = useState<TaxPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [editPayment, setEditPayment] = useState<TaxPayment | null>(null);
  const [viewPayment, setViewPayment] = useState<TaxPayment | null>(null);

  function loadRates() {
    setRatesLoading(true);
    api.get('/tax-rates', { params: { includeInactive: true } }).then((res) => setRates(res.data)).finally(() => setRatesLoading(false));
  }

  function loadPayments() {
    setPaymentsLoading(true);
    api.get('/tax-payments').then((res) => setPayments(res.data)).finally(() => setPaymentsLoading(false));
  }

  useEffect(loadRates, []);
  useEffect(() => {
    if (subTab === 'payments') {
      loadPayments();
      api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
    }
  }, [subTab]);

  async function deactivateRate(id: string) {
    if (!window.confirm('Deactivate this tax rate? It will no longer be offered for new entries.')) return;
    await api.delete(`/tax-rates/${id}`);
    loadRates();
  }

  async function removePayment(id: string) {
    if (!window.confirm('Delete this tax payment? This reverses any linked bank withdrawal.')) return;
    try {
      await api.delete(`/tax-payments/${id}`);
      loadPayments();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this payment.');
    }
  }

  function accountName(id?: string) {
    if (!id) return undefined;
    return bankAccounts.find((a) => a.id === id)?.name;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Pill
          value={subTab}
          onChange={(v) => setSubTab(v as TaxTab)}
          options={[
            { value: 'vat', label: 'VAT Returns' },
            { value: 'rates', label: 'Tax Rates' },
            { value: 'payments', label: 'Tax Payments' },
          ]}
        />
        {canManage && subTab === 'rates' && (
          <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddRate(true)}>Add tax rate</PrimaryButton>
        )}
        {canManage && subTab === 'payments' && (
          <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAddPayment(true)}>Record tax payment</PrimaryButton>
        )}
      </div>

      {subTab === 'vat' && <VatReturnsPanel />}

      {subTab === 'rates' && (
        <>
          {ratesLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : rates.length === 0 ? (
            <EmptyState>No tax rates yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {rates.map((r) => (
                  <div key={r.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${!r.active ? 'opacity-50' : ''}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                        <Percent size={14} className="text-muted" />
                        {r.name}
                        {!r.active && <span className="text-xs text-muted">(inactive)</span>}
                      </div>
                      {r.description && <div className="text-xs text-muted">{r.description}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(r.rate).toFixed(2)}%</div>
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          <IconButton icon={Pencil} requires="edit" title="Edit rate" onClick={() => setEditRate(r)} />
                          {r.active && (
                            <IconButton icon={Trash2} tone="danger" requires="full" title="Deactivate rate" onClick={() => deactivateRate(r.id)} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {showAddRate && (
            <TaxRateModal
              onClose={() => setShowAddRate(false)}
              onSaved={() => {
                setShowAddRate(false);
                loadRates();
              }}
            />
          )}
          {editRate && (
            <TaxRateModal
              rate={editRate}
              onClose={() => setEditRate(null)}
              onSaved={() => {
                setEditRate(null);
                loadRates();
              }}
            />
          )}
        </>
      )}

      {subTab === 'payments' && (
        <>
          {paymentsLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : payments.length === 0 ? (
            <EmptyState>No tax payments recorded yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {payments.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                        <Receipt size={14} className="text-muted" />
                        {p.period}
                      </div>
                      <div className="text-xs text-muted">
                        <span className="whitespace-nowrap">{p.paymentNumber}</span> · {p.datePaid}
                        {p.reference ? ` · Ref: ${p.reference}` : ''}
                        {accountName(p.bankAccountId) ? ` · Paid from ${accountName(p.bankAccountId)}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap">{Number(p.amount).toFixed(3)} OMR</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <IconButton icon={Eye} title="View" onClick={() => setViewPayment(p)} />
                        {p.documentFilePath && (
                          <IconButton icon={Upload} title="View document" onClick={() => viewFile(`/tax-payments/${p.id}/document`)} />
                        )}
                        {canManage && (
                          <>
                            <IconButton icon={Pencil} requires="edit" title="Edit payment" onClick={() => setEditPayment(p)} />
                            <IconButton icon={Trash2} tone="danger" requires="full" title="Delete payment" onClick={() => removePayment(p.id)} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {showAddPayment && (
            <TaxPaymentModal
              bankAccounts={bankAccounts}
              onClose={() => setShowAddPayment(false)}
              onSaved={() => {
                setShowAddPayment(false);
                loadPayments();
              }}
            />
          )}
          {editPayment && (
            <TaxPaymentModal
              payment={editPayment}
              bankAccounts={bankAccounts}
              onClose={() => setEditPayment(null)}
              onSaved={() => {
                setEditPayment(null);
                loadPayments();
              }}
            />
          )}
          {viewPayment && (
            <TaxPaymentViewModal payment={viewPayment} accountName={accountName} onClose={() => setViewPayment(null)} />
          )}
        </>
      )}
    </div>
  );
}

function TaxRateModal({
  rate,
  onClose,
  onSaved,
}: {
  rate?: TaxRate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rate?.name || '');
  const [rateValue, setRateValue] = useState(rate ? String(rate.rate) : '5');
  const [description, setDescription] = useState(rate?.description || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { name, rate: Number(rateValue), description: description || undefined };
      if (rate) await api.patch(`/tax-rates/${rate.id}`, payload);
      else await api.post('/tax-rates', payload);
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this tax rate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={rate ? 'Edit tax rate' : 'Add tax rate'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard VAT (Oman)" required />
        </Field>
        <Field label="Rate (%)">
          <input className={inputClass} type="number" step="0.01" min="0" max="100" value={rateValue} onChange={(e) => setRateValue(e.target.value)} required />
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
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

function TaxPaymentModal({
  payment,
  bankAccounts,
  onClose,
  onSaved,
}: {
  payment?: TaxPayment;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState(payment?.period || '');
  const [vatLabels, setVatLabels] = useState<string[]>([]);
  useEffect(() => {
    api
      .get('/vat-periods')
      .then((res) => setVatLabels((res.data.periods as { label: string }[]).map((p) => p.label)))
      .catch(() => undefined);
  }, []);
  const [amount, setAmount] = useState(payment ? String(payment.amount) : '0');
  const [datePaid, setDatePaid] = useState(payment?.datePaid || localISODate());
  const [reference, setReference] = useState(payment?.reference || '');
  const [note, setNote] = useState(payment?.note || '');
  const [bankAccountId, setBankAccountId] = useState(payment?.bankAccountId || '');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      period,
      amount: Number(amount),
      datePaid,
      reference: reference || undefined,
      note: note || undefined,
      bankAccountId: bankAccountId || undefined,
    };
    try {
      let id = payment?.id;
      if (payment) await api.patch(`/tax-payments/${payment.id}`, payload);
      else {
        const res = await api.post('/tax-payments', payload);
        id = res.data.id;
      }
      // Uploaded right after the payment exists (backend requires the
      // record's id first) — same two-step flow used across this app.
      if (documentFile && id) {
        const formData = new FormData();
        formData.append('file', documentFile);
        await api.post(`/tax-payments/${id}/document`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || `Could not ${payment ? 'update' : 'save'} this tax payment.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={payment ? 'Edit tax payment' : 'Record tax payment'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period">
            <input
              className={inputClass}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="VAT Oct-Dec 2026"
              list="vat-period-labels"
              required
            />
            {/* pick a VAT return period so the payment shows against it on VAT Returns */}
            <datalist id="vat-period-labels">
              {vatLabels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
          <Field label="Amount (OMR)">
            <input className={inputClass} type="number" step="0.001" min="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date paid">
            <input className={inputClass} type="date" value={datePaid} onChange={(e) => setDatePaid(e.target.value)} required />
          </Field>
          <Field label="Reference (optional)">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Tax authority receipt #" />
          </Field>
        </div>
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={payment?.documentFilePath ? 'Replace document (optional)' : 'Document (optional)'}>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className={inputClass}
            onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : payment ? 'Save' : 'Record'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TaxPaymentViewModal({
  payment,
  accountName,
  onClose,
}: {
  payment: TaxPayment;
  accountName: (id?: string) => string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal title="Tax payment" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Reference</span>
          <span className="text-ink font-medium">{payment.paymentNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Period</span>
          <span className="text-ink font-medium">{payment.period}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Amount</span>
          <span className="text-ink font-medium">{Number(payment.amount).toFixed(3)} OMR</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Date paid</span>
          <span className="text-ink font-medium">{payment.datePaid}</span>
        </div>
        {payment.reference && (
          <div className="flex justify-between">
            <span className="text-muted">Tax authority ref</span>
            <span className="text-ink font-medium">{payment.reference}</span>
          </div>
        )}
        {accountName(payment.bankAccountId) && (
          <div className="flex justify-between">
            <span className="text-muted">Paid from</span>
            <span className="text-ink font-medium">{accountName(payment.bankAccountId)}</span>
          </div>
        )}
        {payment.note && (
          <div className="flex justify-between gap-4">
            <span className="text-muted">Note</span>
            <span className="text-ink font-medium text-right">{payment.note}</span>
          </div>
        )}
        {payment.documentFilePath && (
          <div className="pt-2">
            <SecondaryButton icon={Eye} onClick={() => viewFile(`/tax-payments/${payment.id}/document`)}>
              View document
            </SecondaryButton>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}
