import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, RotateCcw, Settings2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, inputClass } from '../components/ui';

interface FiledRow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  otaReference: string | null;
  taxableSales: string | number;
  outputVat: string | number;
  taxablePurchases: string | number;
  inputVat: string | number;
  netVat: string | number;
  purchaseRowsMissingDocuments: number;
  note: string | null;
  filedAt: string;
  filedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
}
interface Period {
  label: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  state: 'in_progress' | 'due' | 'overdue' | 'filed';
  daysToDue: number;
  canFile: boolean;
  blockedReason: string | null;
  paid: number;
  filed: FiledRow | null;
  history: FiledRow[];
}
interface ListResponse {
  settings: { vatPeriodMonths: number; vatPeriodStartMonth: number };
  settingsLocked: boolean;
  lockedThrough: string | null;
  periods: Period[];
}
interface VatSummary {
  taxableSales: number;
  outputVat: number;
  creditNotesVat: number;
  taxablePurchases: number;
  inputVat: number;
  debitNotesVat: number;
  netVatPayable: number;
  purchaseRowsMissingDocuments: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function money(n: number | string | null | undefined) {
  return Number(n || 0).toFixed(3);
}
function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function errText(err: any, fallback: string) {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m || fallback;
}

const stateChip: Record<Period['state'], { label: string; cls: string }> = {
  in_progress: { label: 'In progress', cls: 'bg-black/5 text-ink/70' },
  due: { label: 'Due', cls: 'bg-amber-50 text-amber-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-600 text-white' },
  filed: { label: 'Filed', cls: 'bg-brand-50 text-brand-700' },
};

// Accounting > Tax > VAT Returns. Marking a return as filed closes the
// books up to the end of its period (backend: vat-period.service.ts).
export default function VatReturnsPanel() {
  const { hasAnyRole } = useAuth();
  const canFile = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);
  const canReopen = hasAnyRole(['admin', 'ceo', 'md']);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [filing, setFiling] = useState<Period | null>(null);
  const [reopening, setReopening] = useState<FiledRow | null>(null);
  const [viewing, setViewing] = useState<{ row: FiledRow; paid: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(() => {
    api
      .get('/vat-periods')
      .then((res) => setData(res.data))
      .catch((err) => setError(errText(err, 'Could not load VAT returns.')));
  }, []);
  useEffect(load, [load]);

  if (!data) return <div className="text-sm text-muted">{error || 'Loading…'}</div>;
  const latestFiledEnd = data.lockedThrough;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-sm">
            <div className="font-semibold text-ink">
              VAT returns - {data.settings.vatPeriodMonths === 1 ? 'monthly' : 'quarterly'}, cycle starting in {MONTHS[data.settings.vatPeriodStartMonth - 1]}
            </div>
            <div className="text-muted mt-0.5 max-w-2xl">
              File each return with the Oman Tax Authority within 30 days after its period ends (next working day if that is a holiday), then mark it as filed here.
              Filing closes the books for that period: nothing dated in it can be added, changed or deleted.
            </div>
            {latestFiledEnd && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-700">
                <Lock size={13} /> Books closed up to {fmtDate(latestFiledEnd)} (filed returns)
              </div>
            )}
          </div>
          {canFile && (
            <SecondaryButton icon={Settings2} onClick={() => setShowSettings(true)}>
              Period settings
            </SecondaryButton>
          )}
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {data.periods.length === 0 ? (
        <EmptyState>No VAT periods yet.</EmptyState>
      ) : (
        <Card className="divide-y divide-black/5">
          {data.periods.map((p) => {
            const chip = stateChip[p.state];
            const net = p.filed ? Number(p.filed.netVat) : null;
            return (
              <div key={p.endDate} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-ink">{p.label}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
                    {p.history.length > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700" title="This return was reopened before">
                        Reopened {p.history.length}x
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDate(p.startDate)} - {fmtDate(p.endDate)}
                    {p.state === 'filed' && p.filed
                      ? ` · filed ${new Date(p.filed.filedAt).toLocaleDateString('en-GB')}${p.filed.otaReference ? ` · OTA ref ${p.filed.otaReference}` : ''}`
                      : p.state === 'in_progress'
                        ? ` · return due ${fmtDate(p.dueDate)}`
                        : p.state === 'overdue'
                          ? ` · was due ${fmtDate(p.dueDate)} (${-p.daysToDue} day(s) late)`
                          : ` · due ${fmtDate(p.dueDate)} (${p.daysToDue} day(s) left)`}
                  </div>
                  {p.filed && net !== null && (
                    <div className="text-xs text-ink/80 mt-0.5">
                      Net VAT {money(Math.abs(net))} {net < 0 ? 'refundable' : 'payable'}
                      {net > 0 && ` · paid ${money(p.paid)}${p.paid + 0.0005 < net ? ` (${money(net - p.paid)} still to pay)` : ''}`}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {p.filed ? (
                    <>
                      <SecondaryButton onClick={() => setViewing({ row: p.filed!, paid: p.paid })}>View</SecondaryButton>
                      {canReopen && p.endDate === latestFiledEnd && (
                        <SecondaryButton icon={RotateCcw} onClick={() => setReopening(p.filed)}>
                          Reopen
                        </SecondaryButton>
                      )}
                    </>
                  ) : canFile && p.canFile ? (
                    <PrimaryButton icon={CheckCircle2} onClick={() => setFiling(p)}>
                      Mark as filed
                    </PrimaryButton>
                  ) : p.blockedReason && p.state !== 'in_progress' ? (
                    <span className="text-xs text-muted">{p.blockedReason}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {filing && (
        <FileModal
          period={filing}
          onClose={() => setFiling(null)}
          onDone={() => {
            setFiling(null);
            load();
          }}
        />
      )}
      {reopening && (
        <ReopenModal
          row={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null);
            load();
          }}
        />
      )}
      {viewing && <ViewModal row={viewing.row} paid={viewing.paid} onClose={() => setViewing(null)} />}
      {showSettings && (
        <SettingsModal
          data={data}
          onClose={() => setShowSettings(false)}
          onDone={() => {
            setShowSettings(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${strong ? 'font-semibold border-t border-black/10 mt-1 pt-2' : ''}`}>
      <span className="text-ink/80">{label}</span>
      <span className="text-ink whitespace-nowrap">{value}</span>
    </div>
  );
}

function FileModal({ period, onClose, onDone }: { period: Period; onClose: () => void; onDone: () => void }) {
  const [summary, setSummary] = useState<VatSummary | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/reports/vat-summary', { params: { startDate: period.startDate, endDate: period.endDate } })
      .then((res) => setSummary(res.data))
      .catch((err) => setError(errText(err, 'Could not load the VAT figures.')));
  }, [period]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/vat-periods/file', { startDate: period.startDate, endDate: period.endDate, otaReference: ref.trim() || undefined, note: note.trim() || undefined });
      onDone();
    } catch (err) {
      setError(errText(err, 'Could not mark the return as filed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Mark ${period.label} as filed`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-muted">
          {fmtDate(period.startDate)} - {fmtDate(period.endDate)}. These figures from the books are saved with the filing - they should match the return you submitted
          to the OTA.
        </p>
        {!summary ? (
          <div className="text-muted">{error || 'Loading…'}</div>
        ) : (
          <div className="rounded-lg border border-black/10 px-3 py-2">
            <Line label="Taxable sales" value={money(summary.taxableSales)} />
            <Line label={`Output VAT${summary.creditNotesVat ? ` (after ${money(summary.creditNotesVat)} credit notes)` : ''}`} value={money(summary.outputVat)} />
            <Line label="Taxable purchases" value={money(summary.taxablePurchases)} />
            <Line label={`Input VAT${summary.debitNotesVat ? ` (after ${money(summary.debitNotesVat)} debit notes)` : ''}`} value={`- ${money(summary.inputVat)}`} />
            <Line
              label={summary.netVatPayable >= 0 ? 'Net VAT payable' : 'Net VAT refundable'}
              value={`${money(Math.abs(summary.netVatPayable))} OMR`}
              strong
            />
          </div>
        )}
        {summary && summary.purchaseRowsMissingDocuments > 0 && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            {summary.purchaseRowsMissingDocuments} purchase(s) with VAT are missing the supplier's VATIN or tax invoice number - input VAT on those may not be
            claimable. Check the Purchase VAT report before filing.
          </div>
        )}
        <Field label="OTA acknowledgement / reference number">
          <input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          After this, nothing dated on or before {fmtDate(period.endDate)} can be added, changed or deleted. Only Admin, CEO or MD can reopen it.
        </div>
        <label className="flex items-start gap-2 text-ink/80">
          <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>The return for this period has been submitted to the Oman Tax Authority.</span>
        </label>
        {error && summary && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!checked || !summary || busy}>
            {busy ? 'Saving…' : 'Mark as filed'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ReopenModal({ row, onClose, onDone }: { row: FiledRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/vat-periods/${row.id}/reopen`, { reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(errText(err, 'Could not reopen.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Reopen ${row.label}?`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-ink/80">
          Entries dated {fmtDate(row.startDate)} - {fmtDate(row.endDate)} can be changed again until it is filed again. Admin, CEO, MD and Accountant are emailed.
        </p>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The return was already submitted to the OTA (net VAT {money(row.netVat)}). If the figures change, an amended return or voluntary disclosure may be needed.
        </div>
        <Field label="Reason (required)">
          <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={1000} required />
        </Field>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || reason.trim().length < 5}>
            {busy ? 'Reopening…' : 'Reopen'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ViewModal({ row, paid, onClose }: { row: FiledRow; paid: number; onClose: () => void }) {
  const net = Number(row.netVat);
  return (
    <Modal title={`${row.label} - filed return`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-muted">
          {fmtDate(row.startDate)} - {fmtDate(row.endDate)} · filed {new Date(row.filedAt).toLocaleString('en-GB')} by {row.filedBy || 'unknown'}
          {row.otaReference ? ` · OTA ref ${row.otaReference}` : ''}
        </div>
        <div className="rounded-lg border border-black/10 px-3 py-2">
          <Line label="Taxable sales" value={money(row.taxableSales)} />
          <Line label="Output VAT" value={money(row.outputVat)} />
          <Line label="Taxable purchases" value={money(row.taxablePurchases)} />
          <Line label="Input VAT" value={`- ${money(row.inputVat)}`} />
          <Line label={net >= 0 ? 'Net VAT payable' : 'Net VAT refundable'} value={`${money(Math.abs(net))} OMR`} strong />
          {net > 0 && <Line label="Paid (Tax Payments with this period)" value={money(paid)} />}
        </div>
        {row.purchaseRowsMissingDocuments > 0 && (
          <div className="text-xs text-amber-700">At filing, {row.purchaseRowsMissingDocuments} purchase(s) with VAT were missing supplier VATIN / invoice number.</div>
        )}
        {row.note && <div className="text-ink/80">Note: {row.note}</div>}
        <div className="flex justify-end">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ data, onClose, onDone }: { data: ListResponse; onClose: () => void; onDone: () => void }) {
  const [months, setMonths] = useState(data.settings.vatPeriodMonths);
  const [start, setStart] = useState(data.settings.vatPeriodStartMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put('/vat-periods/settings', { vatPeriodMonths: months, vatPeriodStartMonth: start });
      onDone();
    } catch (err) {
      setError(errText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }
  const cycle = months === 1 ? 'Every month' : [0, 3, 6, 9].map((o) => MONTHS[(start - 1 + o) % 12].slice(0, 3)).join(', ');
  return (
    <Modal title="VAT period settings" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-muted">As on your VAT registration with the Oman Tax Authority ("tax period").</p>
        {data.settingsLocked && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Returns are already filed with the current settings - they cannot change while those are filed.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period length">
            <select className={inputClass} value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={data.settingsLocked}>
              <option value={3}>Quarterly (3 months)</option>
              <option value={1}>Monthly</option>
            </select>
          </Field>
          <Field label="Cycle starts in">
            <select className={inputClass} value={start} onChange={(e) => setStart(Number(e.target.value))} disabled={data.settingsLocked || months === 1}>
              {MONTHS.slice(0, 3).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted">Periods start in: {cycle}</p>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || data.settingsLocked}>
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
