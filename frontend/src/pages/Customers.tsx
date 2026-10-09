import { FormEvent, useEffect, useState } from 'react';
import { ChevronDown, Plus, Eye, Pencil, Trash2, Download, FileText, Upload } from 'lucide-react';
import ImportModal from '../components/ImportModal';
import api from '../api/client';
import { viewPdf, downloadPdf } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
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
import { localISODate } from '../utils/dates';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  crNumber?: string;
  vatin?: string;
  vatApplicable?: boolean;
  creditLimit?: number;
}

interface HistoryDoc {
  id: string;
  createdAt: string;
  total?: number;
  invoiceNumber?: string;
  quotationNumber?: string;
  deliveryNoteNumber?: string;
}

interface CustomerHistory {
  invoices: HistoryDoc[];
  quotations: HistoryDoc[];
  deliveryNotes: HistoryDoc[];
}

export default function Customers() {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin']);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);

  function load() {
    setLoading(true);
    api.get('/customers').then((res) => setCustomers(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function remove(id: string) {
    if (!window.confirm('Delete this customer? This cannot be undone, and MD/CEO/GM will be notified by email.')) return;
    try {
      await api.delete(`/customers/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete customer.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Everyone you sell to"
        action={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton icon={Upload} requires="edit" onClick={() => setShowImport(true)}>Import</SecondaryButton>
            <PrimaryButton icon={Plus} requires="edit" onClick={() => setShowAdd(true)}>New customer</PrimaryButton>
          </div>
        }
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : customers.length === 0 ? (
        <EmptyState>No customers yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {customers.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{c.name}</div>
                  <div className="text-xs text-muted break-words">{c.phone || c.email || '-'}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {c.vatApplicable && <span className="text-xs px-2 py-1 rounded-full bg-brand-50 text-brand-700 font-medium">VAT</span>}
                  <div className="flex items-center gap-1.5">
                    <IconButton icon={Eye} title="View customer data & history" onClick={() => setViewing(c)} />
                    <IconButton icon={Pencil} title="Edit" requires="edit" onClick={() => setEditing(c)} />
                    {canDelete && (
                      <IconButton icon={Trash2} tone="danger" title="Delete (Admin only)" requires="full" onClick={() => remove(c.id)} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showImport && <ImportModal type="customers" label="Customers" onClose={() => setShowImport(false)} onImported={load} />}
      {showAdd && (
        <CustomerModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editing && (
        <CustomerModal
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {viewing && <CustomerDetailModal customer={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CustomerModal({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [crNumber, setCrNumber] = useState(customer?.crNumber || '');
  const [vatin, setVatin] = useState(customer?.vatin || '');
  const [vatApplicable, setVatApplicable] = useState(customer?.vatApplicable ?? true);
  const [creditLimit, setCreditLimit] = useState(customer?.creditLimit ? String(customer.creditLimit) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // "Bank Details" and "Documents" — both collapsed by default, opened
  // with a click, same pattern as HR's "Others Detail". Existing entries
  // (Edit mode) are loaded once when the section is first opened.
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountEntry[]>([]);
  const [showDocuments, setShowDocuments] = useState(false);
  const [documents, setDocuments] = useState<PartyDocumentEntry[]>([]);
  const basePath = customer ? `/customers/${customer.id}` : undefined;

  useEffect(() => {
    if (showBankDetails && customer && bankAccounts.length === 0) {
      loadBankAccounts(`/customers/${customer.id}`).then((rows) =>
        setBankAccounts(rows.length > 0 ? rows : [emptyBankAccount()]),
      );
    } else if (showBankDetails && bankAccounts.length === 0) {
      setBankAccounts([emptyBankAccount()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBankDetails]);

  useEffect(() => {
    if (showDocuments && customer && documents.length === 0) {
      loadPartyDocuments(`/customers/${customer.id}`).then((rows) => setDocuments(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDocuments]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      name,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      crNumber: crNumber || undefined,
      vatin: vatin || undefined,
      vatApplicable,
      creditLimit: creditLimit ? Number(creditLimit) : undefined,
    };
    // set once the record exists: a failing attachment after that must not
    // lead to a second Save creating the record (and moving money) twice
    let created = false;
    try {
      let customerId = customer?.id;
      if (customer) await api.patch(`/customers/${customer.id}`, payload);
      else {
        const res = await api.post('/customers', payload);
        customerId = res.data.id;
        created = true;
      }
      // Bank accounts/documents are saved as a separate step since they
      // need the customer's id, which only exists once created above.
      if (customerId) {
        await saveBankAccounts(`/customers/${customerId}`, bankAccounts);
        await savePartyDocuments(`/customers/${customerId}`, documents);
      }
      onSaved();
    } catch (err: any) {
      if (created) {
        window.alert(`The customer was saved, but bank details/documents could not be saved: ${err?.response?.data?.message || 'unknown error'}. Open it again (Edit) to add them.`);
        onSaved();
        return;
      }
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <Field label="CR Number">
            <input className={inputClass} value={crNumber} onChange={(e) => setCrNumber(e.target.value)} />
          </Field>
          <Field label="Customer VATIN (Optional)">
            <input className={inputClass} value={vatin} onChange={(e) => setVatin(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 items-end sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input type="checkbox" checked={vatApplicable} onChange={(e) => setVatApplicable(e.target.checked)} />
            VAT applies to this customer
          </label>
          <Field label="Credit Limit, OMR (optional — blank means no limit)">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.001"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </Field>
        </div>
        {customer && <CustomerCreditStatus customerId={customer.id} creditLimit={creditLimit ? Number(creditLimit) : undefined} />}

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

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" requires="edit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Shows the customer's own data plus every quotation/invoice/delivery
// note issued to them — each viewable and downloadable as a PDF, same
// as on the Quotations/Invoices/DeliveryNotes list pages.
function CustomerDetailModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/customers/${customer.id}/history`)
      .then((res) => setHistory(res.data))
      .finally(() => setLoading(false));
  }, [customer.id]);

  const sections: { label: string; docs: HistoryDoc[]; endpoint: string; number: (d: HistoryDoc) => string }[] = history
    ? [
        { label: 'Quotations', docs: history.quotations, endpoint: 'quotations', number: (d) => d.quotationNumber || d.id },
        { label: 'Invoices', docs: history.invoices, endpoint: 'invoices', number: (d) => d.invoiceNumber || d.id },
        { label: 'Delivery Notes', docs: history.deliveryNotes, endpoint: 'delivery-notes', number: (d) => d.deliveryNoteNumber || d.id },
      ]
    : [];

  return (
    <Modal title={`Customer: ${customer.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm break-words sm:grid-cols-2">
          <div><span className="text-muted">Phone:</span> {customer.phone || '-'}</div>
          <div><span className="text-muted">Email:</span> {customer.email || '-'}</div>
          <div><span className="text-muted">Address:</span> {customer.address || '-'}</div>
          <div><span className="text-muted">CR Number:</span> {customer.crNumber || '-'}</div>
          <div><span className="text-muted">VATIN:</span> {customer.vatin || '-'}</div>
          <div><span className="text-muted">VAT applicable:</span> {customer.vatApplicable ? 'Yes' : 'No'}</div>
        </div>
        <CustomerCreditStatus
          customerId={customer.id}
          creditLimit={customer.creditLimit !== undefined && customer.creditLimit !== null ? Number(customer.creditLimit) : undefined}
        />
        <CustomerStatementSection customerId={customer.id} />
        <InteractionLogSection basePath={`/customers/${customer.id}`} />

        {loading ? (
          <div className="text-sm text-muted">Loading history…</div>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                {section.label} ({section.docs.length})
              </h3>
              {section.docs.length === 0 ? (
                <p className="text-sm text-muted">None yet.</p>
              ) : (
                <div className="divide-y divide-black/5 border border-black/10 rounded-lg overflow-hidden">
                  {section.docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="text-sm min-w-0">
                        <div className="font-medium text-ink whitespace-nowrap">{section.number(d)}</div>
                        <div className="text-xs text-muted">
                          {new Date(d.createdAt).toLocaleDateString()}
                          {d.total !== undefined ? ` · ${Number(d.total).toFixed(3)} OMR` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <IconButton icon={Eye} title="View PDF" onClick={() => viewPdf(`/${section.endpoint}/${d.id}/pdf`)} />
                        <IconButton
                          icon={Download}
                          title="Download PDF"
                          onClick={() => downloadPdf(`/${section.endpoint}/${d.id}/pdf`, `${section.number(d)}.pdf`)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        <div className="flex justify-end pt-2">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Small "Outstanding X of Y limit" line shown under the Credit Limit
// field (Edit mode) and on the customer detail view — reads the live
// outstanding balance (Step 1's Payment Ledger, Step 2's Aging logic)
// rather than anything stored on the customer itself.
function CustomerCreditStatus({ customerId, creditLimit }: { customerId: string; creditLimit?: number | string | null }) {
  const [outstanding, setOutstanding] = useState<number | null>(null);

  useEffect(() => {
    api.get(`/invoices/customer/${customerId}/outstanding-balance`).then((res) => setOutstanding(Number(res.data.outstanding)));
  }, [customerId]);

  if (outstanding === null) return null;

  // `creditLimit` may arrive as a string here — TypeORM serializes
  // `decimal` columns as strings over JSON, so this coerces defensively
  // no matter what the caller passed (a raw customer.creditLimit from the
  // API, or an already-numeric value from a form's local state).
  const limit = creditLimit !== undefined && creditLimit !== null && creditLimit !== '' ? Number(creditLimit) : undefined;
  const overLimit = !!limit && outstanding > limit;

  return (
    <div className={`text-xs rounded-lg px-3 py-2 ${overLimit ? 'bg-red-50 text-red-700' : 'bg-black/5 text-ink/70'}`}>
      Outstanding balance: <span className="font-medium">{outstanding.toFixed(3)} OMR</span>
      {limit ? (
        <>
          {' '}of <span className="font-medium">{limit.toFixed(3)} OMR</span> limit
          {overLimit && ' — over limit'}
        </>
      ) : (
        ' (no credit limit set)'
      )}
    </div>
  );
}

// "Statement of Account" PDF for a chosen date range — generated fresh
// on every click (not stored), so it always reflects the latest
// invoices/payments. Defaults to the current month.
function defaultStatementRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const toStr = (d: Date) => localISODate(d);
  return { start: toStr(start), end: toStr(now) };
}

function CustomerStatementSection({ customerId }: { customerId: string }) {
  const defaults = defaultStatementRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  const [error, setError] = useState('');

  const statementPath = `/invoices/customer/${customerId}/statement?startDate=${startDate}&endDate=${endDate}`;

  async function handleView() {
    setError('');
    setBusy('view');
    try {
      await viewPdf(statementPath);
    } catch {
      setError('Could not generate the statement. Check the date range.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload() {
    setError('');
    setBusy('download');
    try {
      await downloadPdf(statementPath, `Statement-${startDate}_to_${endDate}.pdf`);
    } catch {
      setError('Could not generate the statement. Check the date range.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 px-3 py-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Statement of Account</h3>
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="From">
          <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="To">
          <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <SecondaryButton icon={Eye} onClick={handleView} disabled={busy !== null}>
          {busy === 'view' ? 'Generating…' : 'View'}
        </SecondaryButton>
        <SecondaryButton icon={FileText} onClick={handleDownload} disabled={busy !== null}>
          {busy === 'download' ? 'Generating…' : 'Download'}
        </SecondaryButton>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
