import { ChangeEvent, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2, AlertCircle, Undo2 } from 'lucide-react';
import api from '../api/client';
import { downloadFile } from '../api/docActions';
import { Modal, PrimaryButton, SecondaryButton } from './ui';

interface AccountOpt {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface Preview {
  fileName: string;
  rowCount: number;
  entryCount: number;
  lineCount: number;
  totalDebit: number;
  firstDate: string | null;
  lastDate: string | null;
  bankLineCount: number;
  errors: { row: number; message: string }[];
  errorCount: number;
  unknownAccounts: { name: string; count: number; firstRow: number; suggestion: { id: string; code: string; name: string } | null }[];
  accountsUsed: { name: string; via: string; count: number; code: string; accountName: string; bank: boolean }[];
  sample: { date: string; entryNo: string; description: string; lines: { account: string; debit: number; credit: number; comments: string }[] }[];
  ready: boolean;
}
interface Batch {
  id: string;
  fileName: string;
  entryCount: number;
  lineCount: number;
  totalDebit: number;
  firstDate: string;
  lastDate: string;
  bankLineCount: number;
  createdByEmail?: string | null;
  createdAt: string;
}

// codes kept by their own modules (same list as the server)
const BLOCKED = new Set(['1100', '2000', '1200', '1210', '1310']);
const fmt = (n: number) => Number(n || 0).toFixed(3);

// Journals > Import: template -> upload -> preview (nothing saved) ->
// match unknown account names once -> import. The server re-checks the
// whole file on import and saves all of it or nothing.
export default function JournalImportModal({ accounts, onClose, onImported }: { accounts: AccountOpt[]; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'preview' | 'map' | 'import' | 'template' | 'undo'>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const options = accounts.filter((a) => a.active && !BLOCKED.has(a.code)).sort((a, b) => a.code.localeCompare(b.code));

  function loadBatches() {
    api.get('/journal-imports').then((r) => setBatches(r.data)).catch(() => {});
  }
  useEffect(loadBatches, []);

  const form = (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    return fd;
  };

  async function runPreview(f: File) {
    setBusy('preview');
    setError('');
    try {
      const res = await api.post('/journal-imports/preview', form(f));
      const p: Preview = res.data;
      setPreview(p);
      const next: Record<string, string> = {};
      for (const u of p.unknownAccounts) if (u.suggestion) next[u.name] = u.suggestion.id;
      setPicks(next);
    } catch (err: any) {
      setPreview(null);
      setError(err?.response?.data?.message || 'Could not read this file.');
    } finally {
      setBusy('');
    }
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setNotice('');
    await runPreview(f);
  }

  async function template() {
    setBusy('template');
    try {
      await downloadFile('/journal-imports/template', 'ARIBS journal import template.xlsx');
    } catch {
      setError('Could not download the template.');
    } finally {
      setBusy('');
    }
  }

  async function saveMappings() {
    if (!preview || !file) return;
    const mappings = preview.unknownAccounts.filter((u) => picks[u.name]).map((u) => ({ name: u.name, accountId: picks[u.name] }));
    if (mappings.length < preview.unknownAccounts.length) {
      setError('Pick an account for every name.');
      return;
    }
    setBusy('map');
    setError('');
    try {
      await api.put('/journal-imports/mappings', { mappings });
      await runPreview(file);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
      setBusy('');
    }
  }

  async function doImport() {
    if (!file || !preview?.ready) return;
    setBusy('import');
    setError('');
    try {
      const res = await api.post('/journal-imports', form(file));
      setNotice(`Imported ${res.data.entryCount} entries (${res.data.firstDate} to ${res.data.lastDate}).`);
      setPreview(null);
      setFile(null);
      loadBatches();
      onImported();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Import failed - nothing was saved.');
    } finally {
      setBusy('');
    }
  }

  async function undo(b: Batch) {
    if (!window.confirm(`Undo "${b.fileName}"? All ${b.entryCount} entries from it (and their bank lines) are removed.`)) return;
    setBusy('undo');
    setError('');
    try {
      await api.delete(`/journal-imports/${b.id}`);
      setNotice(`"${b.fileName}" was undone.`);
      loadBatches();
      onImported();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not undo.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Modal title="Import journal entries" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-muted leading-relaxed">
          Columns: <b className="text-ink">Date, Entry No (optional), Description, Account, Debit, Credit, Comments</b>. One row = one debit or credit
          line; rows with the same Entry No (or, without it, the next rows until debits = credits) make one entry. Account = code, ERP name or
          your own name (matched once). Nothing is saved until the whole file is correct.
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton icon={Download} onClick={template} disabled={busy !== ''}>
            Download template
          </SecondaryButton>
          <label className={`inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
            <FileSpreadsheet size={15} />
            {file ? 'Choose another file' : 'Choose file (.xlsx / .csv)'}
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={choose} />
          </label>
        </div>
        {busy === 'preview' && <div className="text-muted">Checking the file…</div>}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</div>}
        {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-green-800">{notice}</div>}

        {preview && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Entries', String(preview.entryCount)],
                ['Lines', String(preview.lineCount)],
                ['Total debit', fmt(preview.totalDebit)],
                ['Dates', preview.firstDate ? `${preview.firstDate} → ${preview.lastDate}` : '-'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-black/[0.03] px-3 py-2">
                  <div className="text-xs text-muted">{k}</div>
                  <div className="font-semibold text-ink break-words">{v}</div>
                </div>
              ))}
            </div>

            {preview.unknownAccounts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="font-medium text-amber-900">Match these account names once ({preview.unknownAccounts.length})</div>
                <div className="text-xs text-amber-900/80 mb-2">
                  The ERP remembers each match for later files. An account that doesn't exist yet: add it in Chart of Accounts, then choose the
                  file again.
                </div>
                <div className="space-y-2">
                  {preview.unknownAccounts.map((u) => (
                    <div key={u.name} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-1 sm:gap-3 items-center">
                      <div className="text-ink">
                        {u.name} <span className="text-xs text-muted">({u.count} lines)</span>
                      </div>
                      <select
                        className="w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm"
                        value={picks[u.name] || ''}
                        onChange={(e) => setPicks((p) => ({ ...p, [u.name]: e.target.value }))}
                      >
                        <option value="">Choose account…</option>
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <PrimaryButton requires="edit" onClick={saveMappings} disabled={busy !== ''}>
                    {busy === 'map' ? 'Saving…' : 'Save matches & check again'}
                  </PrimaryButton>
                </div>
              </div>
            )}

            {preview.errorCount > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-center gap-1.5 font-medium text-red-800 mb-1">
                  <AlertCircle size={15} /> {preview.errorCount} problem(s) - fix them in the file and choose it again
                </div>
                <div className="max-h-48 overflow-y-auto text-xs text-red-800 space-y-0.5">
                  {preview.errors.map((e, i) => (
                    <div key={i}>{e.row ? `Row ${e.row}: ` : ''}{e.message}</div>
                  ))}
                </div>
              </div>
            )}

            {preview.accountsUsed.length > 0 && (
              <details className="rounded-lg border border-black/10 p-3">
                <summary className="cursor-pointer font-medium text-ink">Accounts in this file ({preview.accountsUsed.length})</summary>
                <div className="mt-2 space-y-1 text-xs">
                  {preview.accountsUsed.map((a) => (
                    <div key={a.name} className="flex justify-between gap-2">
                      <span className="text-ink">{a.name}</span>
                      <span className="text-muted text-right">
                        → {a.code} {a.accountName}
                        {a.bank ? ' (bank lines)' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {preview.sample.length > 0 && (
              <details className="rounded-lg border border-black/10 p-3">
                <summary className="cursor-pointer font-medium text-ink">First entries ({preview.sample.length})</summary>
                <div className="mt-2 space-y-2 text-xs">
                  {preview.sample.map((e, i) => (
                    <div key={i} className="border-b border-black/5 pb-2 last:border-0">
                      <div className="font-medium text-ink">
                        {e.date} · {e.description || '-'}
                      </div>
                      {e.lines.map((l, j) => (
                        <div key={j} className="flex justify-between gap-2 text-muted">
                          <span className="truncate">
                            {l.account}
                            {l.comments ? ` - ${l.comments}` : ''}
                          </span>
                          <span className="whitespace-nowrap">{l.debit ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center justify-end gap-2">
              {preview.ready && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                  <CheckCircle2 size={14} /> Ready
                </span>
              )}
              <PrimaryButton requires="edit" disabled={!preview.ready || busy !== ''} onClick={doImport}>
                {busy === 'import' ? 'Importing…' : `Import ${preview.entryCount} entries`}
              </PrimaryButton>
            </div>
          </>
        )}

        <div>
          <div className="font-semibold text-ink mb-2">Imported files</div>
          {batches.length === 0 ? (
            <div className="text-muted">None yet.</div>
          ) : (
            <div className="divide-y divide-black/5 rounded-lg border border-black/10">
              {batches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate">{b.fileName}</div>
                    <div className="text-xs text-muted">
                      {b.entryCount} entries · {b.firstDate} → {b.lastDate} · Dr {fmt(b.totalDebit)} · {new Date(b.createdAt).toLocaleDateString('en-GB')}
                      {b.createdByEmail ? ` · ${b.createdByEmail}` : ''}
                    </div>
                  </div>
                  <SecondaryButton icon={Undo2} requires="full" onClick={() => undo(b)} disabled={busy !== ''}>
                    Undo
                  </SecondaryButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
