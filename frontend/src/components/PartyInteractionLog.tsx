// Shared "Interaction Log" section used by both the Customer detail
// view and the Supplier edit form (CRM Step 6). Unlike Bank Details/
// Documents (saved in bulk when the parent form submits), each entry
// here is created/deleted immediately — it's a running log, not
// editable business data, so there's nothing to "save" later.
import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, IconButton, SecondaryButton, PrimaryButton, inputClass } from './ui';
import api from '../api/client';

export const INTERACTION_TYPES: { value: string; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'note', label: 'Note' },
  { value: 'other', label: 'Other' },
];

export interface InteractionEntry {
  id: string;
  type: string;
  subject?: string;
  notes?: string;
  interactionDate: string;
  createdByEmail?: string;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function typeLabel(type: string) {
  return INTERACTION_TYPES.find((t) => t.value === type)?.label || type;
}

// `basePath` is e.g. `/customers/<id>` or `/suppliers/<id>`.
export function InteractionLogSection({ basePath }: { basePath: string }) {
  const [entries, setEntries] = useState<InteractionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('call');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [interactionDate, setInteractionDate] = useState(todayStr());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get(`${basePath}/interactions`)
      .then((res) => setEntries(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(load, [basePath]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`${basePath}/interactions`, {
        type,
        subject: subject || undefined,
        notes: notes || undefined,
        interactionDate,
      });
      setSubject('');
      setNotes('');
      setInteractionDate(todayStr());
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not log this interaction.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this log entry?')) return;
    await api.delete(`${basePath}/interactions/${id}`);
    load();
  }

  return (
    <div className="rounded-lg border border-black/10 px-3 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Interaction Log</h3>
        <SecondaryButton icon={Plus} requires="edit" onClick={() => setShowForm((v) => !v)}>
          Log interaction
        </SecondaryButton>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="space-y-2 border-b border-black/10 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                {INTERACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                className={inputClass}
                type="date"
                value={interactionDate}
                onChange={(e) => setInteractionDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Subject (optional)">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={() => setShowForm(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" requires="edit" disabled={busy}>
              {busy ? 'Saving…' : 'Save entry'}
            </PrimaryButton>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted">No interactions logged yet.</p>
      ) : (
        <div className="divide-y divide-black/5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start justify-between py-2 gap-2">
              <div className="text-sm min-w-0 break-words">
                <div className="font-medium text-ink">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-black/5 text-ink/70 mr-1.5">{typeLabel(entry.type)}</span>
                  {entry.subject || <span className="text-muted">(no subject)</span>}
                </div>
                {entry.notes && <div className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{entry.notes}</div>}
                <div className="text-xs text-muted mt-0.5">
                  {entry.interactionDate}
                  {entry.createdByEmail ? ` · ${entry.createdByEmail}` : ''}
                </div>
              </div>
              <IconButton icon={Trash2} tone="danger" title="Delete" requires="full" onClick={() => remove(entry.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
