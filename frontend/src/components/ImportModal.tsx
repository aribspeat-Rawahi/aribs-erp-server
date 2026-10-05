import { ChangeEvent, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react';
import api from '../api/client';
import { downloadFile } from '../api/docActions';
import { Modal, PrimaryButton, SecondaryButton, Pill } from './ui';

export type ImportType = 'customers' | 'suppliers' | 'finished-goods' | 'raw-materials';

interface PreviewRow {
  row: number;
  status: 'ok' | 'duplicate' | 'error';
  messages: string[];
  cells: Record<string, string>;
}
interface Preview {
  label: string;
  headers: string[];
  ignoredColumns: string[];
  counts: { total: number; ok: number; duplicate: number; error: number };
  rows: PreviewRow[];
}

const SHOW_MAX = 300;

// Bulk Import: download template -> upload .xlsx/.csv -> preview (nothing
// saved yet) -> import. The server re-checks the file on import, so the
// preview is only a view.
export default function ImportModal({
  type,
  label,
  onClose,
  onImported,
}: {
  type: ImportType;
  label: string; // "Customers"
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState('all');
  const [skipErrors, setSkipErrors] = useState(false);
  const [busy, setBusy] = useState<'' | 'preview' | 'import' | 'template'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skippedExisting: number; skippedErrors: number } | null>(null);

  async function template() {
    setBusy('template');
    try {
      await downloadFile(`/import/${type}/template`, `ARIBS ${label} import template.xlsx`);
    } catch {
      setError('Could not download the template.');
    } finally {
      setBusy('');
    }
  }

  function form(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    return fd;
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(null);
    setResult(null);
    setError('');
    setSkipErrors(false);
    setFilter('all');
    setBusy('preview');
    try {
      const res = await api.post(`/import/${type}/preview`, form(f));
      setPreview(res.data);
      if (res.data.counts.error > 0) setFilter('error');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not read this file.');
    } finally {
      setBusy('');
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setBusy('import');
    setError('');
    try {
      const fd = form(file);
      fd.append('skipErrors', String(skipErrors));
      const res = await api.post(`/import/${type}/commit`, fd);
      setResult(res.data);
      onImported();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Import failed - nothing was saved.');
    } finally {
      setBusy('');
    }
  }

  const rows = useMemo(() => (preview ? preview.rows.filter((r) => filter === 'all' || r.status === filter) : []), [preview, filter]);
  const keyHeaders = preview ? preview.headers.slice(0, 4) : [];
  const c = preview?.counts;
  const canImport = !!c && c.ok > 0 && (c.error === 0 || skipErrors) && !result;

  return (
    <Modal title={`Import ${label}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {result ? (
          <div className="rounded-lg border border-brand-400 bg-brand-50 p-4 text-brand-700">
            <div className="font-semibold">Imported {result.created} {label.toLowerCase()}.</div>
            <div className="text-xs mt-1">
              Skipped: {result.skippedExisting} already existing, {result.skippedErrors} with errors.
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-black/10 p-3">
                <div className="font-medium text-ink">1. Get the template</div>
                <p className="text-xs text-muted mt-1">Excel file with the right columns, a Unit dropdown and a Help sheet.</p>
                <SecondaryButton icon={Download} onClick={template} disabled={busy === 'template'} className="mt-2">
                  {busy === 'template' ? 'Downloading…' : 'Download template'}
                </SecondaryButton>
              </div>
              <div className="rounded-lg border border-black/10 p-3">
                <div className="font-medium text-ink">2. Upload your file</div>
                <p className="text-xs text-muted mt-1">.xlsx or .csv, up to 2000 rows. Nothing is saved until you press Import.</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-black/5">
                  <FileSpreadsheet size={16} />
                  {busy === 'preview' ? 'Checking…' : file ? 'Choose another file' : 'Choose file'}
                  <input type="file" className="hidden" accept=".xlsx,.csv" onChange={choose} disabled={!!busy} />
                </label>
                {file && <div className="mt-1 text-xs text-muted break-all">{file.name}</div>}
              </div>
            </div>

            {preview && c && (
              <>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{c.ok} ready to import</span>
                  <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-semibold text-ink/70">{c.duplicate} already exist (skipped)</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${c.error ? 'bg-red-50 text-red-600' : 'bg-black/5 text-ink/50'}`}>
                    {c.error} with errors
                  </span>
                </div>
                {preview.ignoredColumns.length > 0 && (
                  <p className="text-xs text-amber-700">Ignored columns (not used by the ERP): {preview.ignoredColumns.join(', ')}</p>
                )}
                <Pill
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: `All (${c.total})` },
                    { value: 'error', label: `Errors (${c.error})` },
                    { value: 'duplicate', label: `Existing (${c.duplicate})` },
                    { value: 'ok', label: `Ready (${c.ok})` },
                  ]}
                />
                <div className="max-h-[45vh] overflow-auto rounded-lg border border-black/10">
                  <table className="w-full sm:min-w-[640px] text-xs">
                    <thead className="sticky top-0 bg-cream text-muted">
                      <tr>
                        <th className="px-2 py-2 text-left">Row</th>
                        <th className="px-2 py-2 text-left">Status</th>
                        <th className="px-2 py-2 text-left whitespace-nowrap">{keyHeaders[0]}</th>
                        <th className="px-2 py-2 text-left sm:min-w-[200px]">Problems</th>
                        {keyHeaders.slice(1).map((h) => (
                          <th key={h} className="hidden sm:table-cell px-2 py-2 text-left whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {rows.slice(0, SHOW_MAX).map((r) => (
                        <tr key={r.row} className={r.status === 'error' ? 'bg-red-50/50' : ''}>
                          <td className="px-2 py-1.5 text-muted">{r.row}</td>
                          <td className="px-2 py-1.5">
                            {r.status === 'ok' ? (
                              <CheckCircle2 size={15} className="text-brand-600" aria-label="Ready" />
                            ) : r.status === 'duplicate' ? (
                              <MinusCircle size={15} className="text-ink/40" aria-label="Already exists" />
                            ) : (
                              <AlertCircle size={15} className="text-red-600" aria-label="Error" />
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-ink max-w-[120px] sm:max-w-[180px] truncate" title={r.cells[keyHeaders[0]]}>
                            {r.cells[keyHeaders[0]]}
                          </td>
                          <td className={`px-2 py-1.5 ${r.status === 'error' ? 'text-red-600' : 'text-muted'}`}>{r.messages.join(' ')}</td>
                          {keyHeaders.slice(1).map((h) => (
                            <td key={h} className="hidden sm:table-cell px-2 py-1.5 text-ink max-w-[180px] truncate" title={r.cells[h]}>
                              {r.cells[h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && <div className="p-3 text-muted">No rows here.</div>}
                  {rows.length > SHOW_MAX && <div className="p-2 text-xs text-muted">Showing the first {SHOW_MAX} of {rows.length} rows.</div>}
                </div>
                {c.error > 0 && (
                  <label className="flex items-start gap-2 text-ink/80">
                    <input type="checkbox" className="mt-0.5" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                    <span>
                      Skip the {c.error} row(s) with errors and import the rest. (Or fix them in the file and upload it again.)
                    </span>
                  </label>
                )}
              </>
            )}
          </>
        )}

        {error && <p className="text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>{result ? 'Close' : 'Cancel'}</SecondaryButton>
          {!result && (
            <PrimaryButton requires="edit" onClick={runImport} disabled={!canImport || busy === 'import'}>
              {busy === 'import' ? 'Importing…' : `Import ${c?.ok ?? 0} row${c?.ok === 1 ? '' : 's'}`}
            </PrimaryButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
