import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, EmptyState, Pill } from '../components/ui';

interface LogEntry {
  id: string;
  userEmail?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: string;
  createdAt: string;
}

const ENTITY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'quotation', label: 'Quotations' },
  { value: 'delivery_note', label: 'Delivery Notes' },
];

export default function ActivityLog() {
  const [filter, setFilter] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get('/activity-logs', { params: filter ? { entityType: filter } : {} })
      .then((res) => setLogs(res.data))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Who changed what, and when" />
      <div className="mb-4">
        <Pill value={filter} onChange={setFilter} options={ENTITY_FILTERS} />
      </div>
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : logs.length === 0 ? (
        <EmptyState>No activity recorded yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-black/5 flex items-center justify-center shrink-0 mt-0.5">
                  <History size={14} className="text-ink/60" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-ink">
                    <span className="font-medium">{log.userEmail || 'System'}</span> — {log.action}
                    {log.entityType && (
                      <span className="text-muted">
                        {' '}
                        ({log.entityType}
                        {log.entityId ? ` #${log.entityId.slice(0, 8)}` : ''})
                      </span>
                    )}
                  </div>
                  {log.details && <div className="text-xs text-muted mt-0.5 break-all">{log.details}</div>}
                </div>
                <div className="text-xs text-muted whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
