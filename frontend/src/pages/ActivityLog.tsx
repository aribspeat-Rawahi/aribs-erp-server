import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { History, Trash2, RotateCcw, Eye } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, Pill, IconButton, Modal, PrimaryButton, SecondaryButton } from '../components/ui';

interface LogEntry {
  id: string;
  userEmail?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: string;
  createdAt: string;
}

// Activity Log > Deleted (GET /deleted-records)
interface DeletedRecord {
  id: string;
  entityType: string;
  label: string;
  deletedByEmail?: string | null;
  deletedByName?: string | null;
  deletedByRole?: string | null;
  ipAddress?: string | null;
  deletedAt: string;
  restorable: boolean;
  notRestorableReason?: string | null;
  restoreExpiresAt?: string | null;
  restoredAt?: string | null;
  restoredByEmail?: string | null;
  canUndo: boolean;
  rows?: { table: string; data: Record<string, unknown> }[];
}

const ENTITY_FILTERS = [
  { value: '', label: 'All' },
  { value: '__deleted', label: 'Deleted' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'quotation', label: 'Quotations' },
  { value: 'delivery_note', label: 'Delivery Notes' },
];

function parseDetails(details?: string): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const d = JSON.parse(details);
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString() : '';
}

export default function ActivityLog() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const restoreId = params.get('restore');
  const [filter, setFilter] = useState(restoreId ? '__deleted' : '');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deleted, setDeleted] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<DeletedRecord | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    const req =
      filter === '__deleted'
        ? api.get('/deleted-records').then((res) => setDeleted(res.data))
        : api.get('/activity-logs', { params: filter ? { entityType: filter } : {} }).then((res) => setLogs(res.data));
    req.catch(() => undefined).finally(() => setLoading(false));
  }, [filter, reload]);

  // opened from the "Undo this delete" link in the email
  useEffect(() => {
    if (!restoreId) return;
    openRecord(restoreId);
  }, [restoreId]);

  async function openRecord(id: string) {
    try {
      const res = await api.get(`/deleted-records/${id}`);
      setViewing(res.data);
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not open this deleted record.');
    }
  }

  function closeViewing() {
    setViewing(null);
    if (restoreId) {
      params.delete('restore');
      setParams(params, { replace: true });
    }
  }

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Who changed what, and when" />
      <div className="mb-4">
        <Pill value={filter} onChange={setFilter} options={ENTITY_FILTERS} />
      </div>
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : filter === '__deleted' ? (
        deleted.length === 0 ? (
          <EmptyState>Nothing has been deleted yet.</EmptyState>
        ) : (
          <Card>
            <div className="divide-y divide-black/5">
              {deleted.map((r) => (
                <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600">Deleted</span>
                      <span className="text-sm font-medium text-ink break-words">{r.label}</span>
                    </div>
                    <div className="text-xs text-muted break-words">
                      By {r.deletedByName ? `${r.deletedByName} · ` : ''}
                      {r.deletedByEmail || 'unknown'}
                      {r.deletedByRole ? ` (${r.deletedByRole})` : ''} · {fmt(r.deletedAt)}
                      {r.ipAddress ? ` · IP ${r.ipAddress}` : ''}
                    </div>
                    <div className="text-xs">
                      {r.restoredAt ? (
                        <span className="text-brand-700">Restored by {r.restoredByEmail || 'someone'} · {fmt(r.restoredAt)}</span>
                      ) : r.canUndo ? (
                        <span className="text-muted">Can be undone until {fmt(r.restoreExpiresAt)}</span>
                      ) : (
                        <span className="text-muted">Undo not available: {r.notRestorableReason}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <IconButton icon={Eye} title="View deleted data" onClick={() => openRecord(r.id)} />
                    {r.canUndo && <IconButton icon={RotateCcw} tone="success" title="Undo this delete" onClick={() => openRecord(r.id)} />}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      ) : logs.length === 0 ? (
        <EmptyState>No activity recorded yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {logs.map((log) => {
              const d = parseDetails(log.details);
              const isDelete = log.action.endsWith('.deleted');
              const isRestore = log.action.endsWith('.restored');
              const deletedRecordId = typeof d?.deletedRecordId === 'string' ? d.deletedRecordId : null;
              return (
                <div key={log.id} className="flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1 sm:gap-3 px-4 py-3">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      isDelete ? 'bg-red-50' : isRestore ? 'bg-brand-50' : 'bg-black/5'
                    }`}
                  >
                    {isDelete ? (
                      <Trash2 size={14} className="text-red-600" />
                    ) : isRestore ? (
                      <RotateCcw size={14} className="text-brand-700" />
                    ) : (
                      <History size={14} className="text-ink/60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-[calc(100%-2.5rem)] sm:min-w-0">
                    <div className="text-sm text-ink">
                      <span className="font-medium">{log.userEmail || 'System'}</span> — {log.action}
                      {typeof d?.label === 'string' ? (
                        <span className="text-ink/80"> · {d.label}</span>
                      ) : (
                        log.entityType && (
                          <span className="text-muted">
                            {' '}
                            ({log.entityType}
                            {log.entityId ? ` #${log.entityId.slice(0, 8)}` : ''})
                          </span>
                        )
                      )}
                    </div>
                    {log.details && <div className="text-xs text-muted mt-0.5 break-all">{log.details}</div>}
                    {isDelete && deletedRecordId && (
                      <button type="button" className="mt-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => openRecord(deletedRecordId)}>
                        View deleted data / undo
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-muted whitespace-nowrap pl-10 sm:pl-0">{fmt(log.createdAt)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {viewing && (
        <DeletedRecordModal
          record={viewing}
          onClose={closeViewing}
          onRestored={(r) => {
            closeViewing();
            setReload((x) => x + 1);
            window.alert(`Restored: ${r.label}`);
          }}
          onOpenList={() => {
            closeViewing();
            navigate('/activity-log');
            setFilter('__deleted');
          }}
        />
      )}
    </div>
  );
}

// The deleted data (proof) and the Undo button.
function DeletedRecordModal({
  record,
  onClose,
  onRestored,
  onOpenList,
}: {
  record: DeletedRecord;
  onClose: () => void;
  onRestored: (r: DeletedRecord) => void;
  onOpenList: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const main = record.rows?.length ? record.rows[record.rows.length - 1] : null;
  const fields = main
    ? Object.entries(main.data).filter(([k, v]) => v !== null && v !== '' && typeof v !== 'object' && !/(^id$|Hash$|Path$|^sequenceNumber$)/.test(k))
    : [];
  const related = (record.rows?.length || 0) - (main ? 1 : 0);

  async function undo() {
    if (!window.confirm(`Undo this delete and restore "${record.label}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/deleted-records/${record.id}/restore`);
      onRestored(record);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not undo this delete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Deleted record" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div>
          <div className="font-medium text-ink break-words">{record.label}</div>
          <div className="text-xs text-muted break-words">
            Deleted by {record.deletedByName ? `${record.deletedByName} · ` : ''}
            {record.deletedByEmail || 'unknown'}
            {record.deletedByRole ? ` (${record.deletedByRole})` : ''} · {fmt(record.deletedAt)}
            {record.ipAddress ? ` · IP ${record.ipAddress}` : ''}
          </div>
        </div>
        {fields.length > 0 && (
          <div className="rounded-lg border border-black/10 divide-y divide-black/5">
            {fields.slice(0, 24).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="text-muted">{k}</span>
                <span className="text-ink text-right break-all">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
        {related > 0 && <div className="text-xs text-muted">Plus {related} related row(s) (lines, documents, notes ...) that are restored with it.</div>}
        {record.restoredAt ? (
          <p className="text-brand-700">Already restored by {record.restoredByEmail || 'someone'} · {fmt(record.restoredAt)}</p>
        ) : record.canUndo ? (
          <p className="text-xs text-muted">Undo is possible until {fmt(record.restoreExpiresAt)}. Stock, amounts and payments are put back as they were.</p>
        ) : (
          <p className="text-amber-700">Undo not available: {record.notRestorableReason}</p>
        )}
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <SecondaryButton onClick={onOpenList}>All deleted records</SecondaryButton>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          {record.canUndo && (
            <PrimaryButton icon={RotateCcw} onClick={undo} disabled={busy}>
              {busy ? 'Restoring…' : 'Undo delete'}
            </PrimaryButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
