// Shared "Bank Details" + "Documents" form sections used by both the
// Customer and Supplier entry forms (Add and Edit). A customer/supplier
// can have several bank accounts and several documents, so both are
// repeatable lists with an "Add Another ..." button — same building
// blocks, only the base API path (`/customers/:id` vs `/suppliers/:id`)
// differs, which is why this lives outside either page.
import { useRef } from 'react';
import { Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { Field, IconButton, SecondaryButton, inputClass } from './ui';
import { useCan } from './Permission';
import api from '../api/client';
import { viewFile } from '../api/docActions';

export const PARTY_DOCUMENT_TYPES = ['CR Paper', 'Vat Reg. Paper', 'Riyada', 'Others'];

// ---------- Bank Details ----------

export interface BankAccountEntry {
  _key: string;
  id?: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  branchName: string;
  branchCode: string;
  swiftCode: string;
  iban: string;
  statementFile: File | null; // a newly picked file, not uploaded yet
  statementOriginalName?: string; // already on the server (Edit mode)
}

function newKey() {
  return Math.random().toString(36).slice(2);
}

export function emptyBankAccount(): BankAccountEntry {
  return {
    _key: newKey(),
    accountName: '',
    accountNumber: '',
    bankName: '',
    branchName: '',
    branchCode: '',
    swiftCode: '',
    iban: '',
    statementFile: null,
  };
}

// Loads an existing customer's/supplier's saved bank accounts into the
// editable shape the form uses. `basePath` is e.g. `/customers/<id>`.
export async function loadBankAccounts(basePath: string): Promise<BankAccountEntry[]> {
  const res = await api.get(`${basePath}/bank-accounts`);
  return res.data.map((r: any) => ({
    _key: r.id,
    id: r.id,
    accountName: r.accountName || '',
    accountNumber: r.accountNumber || '',
    bankName: r.bankName || '',
    branchName: r.branchName || '',
    branchCode: r.branchCode || '',
    swiftCode: r.swiftCode || '',
    iban: r.iban || '',
    statementFile: null,
    statementOriginalName: r.statementOriginalName || undefined,
  }));
}

// Saves every bank-account entry for a customer/supplier that now has an
// id — new rows are POSTed, existing ones PATCHed, and a picked statement
// file is uploaded right after. A block left completely blank (an unused
// "Add Another Account" row) is skipped rather than saved as an empty row.
export async function saveBankAccounts(basePath: string, entries: BankAccountEntry[]) {
  for (const entry of entries) {
    const payload = {
      accountName: entry.accountName || undefined,
      accountNumber: entry.accountNumber || undefined,
      bankName: entry.bankName || undefined,
      branchName: entry.branchName || undefined,
      branchCode: entry.branchCode || undefined,
      swiftCode: entry.swiftCode || undefined,
      iban: entry.iban || undefined,
    };
    const isBlank = !entry.id && !entry.statementFile && Object.values(payload).every((v) => !v);
    if (isBlank) continue;

    let id = entry.id;
    if (id) {
      await api.patch(`${basePath}/bank-accounts/${id}`, payload);
    } else {
      const res = await api.post(`${basePath}/bank-accounts`, payload);
      id = res.data.id;
    }
    if (entry.statementFile) {
      const formData = new FormData();
      formData.append('file', entry.statementFile);
      await api.post(`${basePath}/bank-accounts/${id}/statement`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }
  }
}

export async function deleteBankAccount(basePath: string, id: string) {
  await api.delete(`${basePath}/bank-accounts/${id}`);
}

export function BankDetailsFields({
  entries,
  onChange,
  basePath,
}: {
  entries: BankAccountEntry[];
  onChange: (entries: BankAccountEntry[]) => void;
  // When set (Edit mode, existing customer/supplier), removing an
  // already-saved account deletes it immediately instead of just
  // dropping it from local state.
  basePath?: string;
}) {
  const can = useCan();
  function update(key: string, patch: Partial<BankAccountEntry>) {
    onChange(entries.map((e) => (e._key === key ? { ...e, ...patch } : e)));
  }
  function addAnother() {
    onChange([...entries, emptyBankAccount()]);
  }
  async function removeEntry(entry: BankAccountEntry) {
    if (entry.id && basePath) await deleteBankAccount(basePath, entry.id);
    onChange(entries.filter((e) => e._key !== entry._key));
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, idx) => (
        <div key={entry._key} className="border border-black/10 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">Bank Account {idx + 1}</span>
            {/* removing a saved account is a DELETE (full); an unsaved one is just local */}
            {entries.length > 1 && (!entry.id || !basePath || can('full')) && (
              <IconButton icon={Trash2} tone="danger" title="Remove this account" onClick={() => removeEntry(entry)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account Name (optional)">
              <input
                className={inputClass}
                value={entry.accountName}
                onChange={(e) => update(entry._key, { accountName: e.target.value })}
              />
            </Field>
            <Field label="Account Number (optional)">
              <input
                className={inputClass}
                value={entry.accountNumber}
                onChange={(e) => update(entry._key, { accountNumber: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank Name (optional)">
              <input
                className={inputClass}
                value={entry.bankName}
                onChange={(e) => update(entry._key, { bankName: e.target.value })}
              />
            </Field>
            <Field label="Branch Name (optional)">
              <input
                className={inputClass}
                value={entry.branchName}
                onChange={(e) => update(entry._key, { branchName: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch Code (optional)">
              <input
                className={inputClass}
                value={entry.branchCode}
                onChange={(e) => update(entry._key, { branchCode: e.target.value })}
              />
            </Field>
            <Field label="Swift Code (optional)">
              <input
                className={inputClass}
                value={entry.swiftCode}
                onChange={(e) => update(entry._key, { swiftCode: e.target.value })}
              />
            </Field>
          </div>
          <Field label="IBAN (optional)">
            <input className={inputClass} value={entry.iban} onChange={(e) => update(entry._key, { iban: e.target.value })} />
          </Field>
          <BankStatementUpload
            entry={entry}
            onFileSelected={(file) => update(entry._key, { statementFile: file })}
            onView={basePath && entry.id ? () => viewFile(`${basePath}/bank-accounts/${entry.id}/statement`) : undefined}
          />
        </div>
      ))}
      <SecondaryButton icon={Plus} requires="edit" onClick={addAnother}>
        Add Another Account
      </SecondaryButton>
    </div>
  );
}

function BankStatementUpload({
  entry,
  onFileSelected,
  onView,
}: {
  entry: BankAccountEntry;
  onFileSelected: (file: File) => void;
  onView?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="block text-xs font-medium text-muted mb-1">Statement Upload (optional)</span>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <SecondaryButton icon={Upload} requires="edit" onClick={() => inputRef.current?.click()}>
          {entry.statementFile || entry.statementOriginalName ? 'Replace file' : 'Upload file'}
        </SecondaryButton>
        {entry.statementFile ? (
          <span className="text-xs text-muted">{entry.statementFile.name} (not saved yet)</span>
        ) : entry.statementOriginalName ? (
          onView ? (
            <button type="button" onClick={onView} className="text-xs text-brand-600 font-medium hover:underline">
              {entry.statementOriginalName}
            </button>
          ) : (
            <span className="text-xs text-muted">{entry.statementOriginalName}</span>
          )
        ) : null}
      </div>
    </div>
  );
}

// ---------- Documents ----------

export interface PartyDocumentEntry {
  _key: string;
  id?: string;
  docType: string;
  file: File | null; // a newly picked file, not uploaded yet
  originalName?: string; // already on the server (Edit mode)
}

export function emptyPartyDocument(): PartyDocumentEntry {
  return { _key: newKey(), docType: PARTY_DOCUMENT_TYPES[0], file: null };
}

export async function loadPartyDocuments(basePath: string): Promise<PartyDocumentEntry[]> {
  const res = await api.get(`${basePath}/documents`);
  return res.data.map((r: any) => ({
    _key: r.id,
    id: r.id,
    docType: r.docType,
    file: null,
    originalName: r.originalName,
  }));
}

// Uploads every not-yet-saved document entry (one row per file, so
// existing rows with an id are left alone — a document is replaced by
// deleting it and adding a new one, not edited in place).
export async function savePartyDocuments(basePath: string, entries: PartyDocumentEntry[]) {
  for (const entry of entries) {
    if (entry.id || !entry.file) continue;
    const formData = new FormData();
    formData.append('file', entry.file);
    formData.append('docType', entry.docType);
    await api.post(`${basePath}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
}

export async function deletePartyDocument(basePath: string, id: string) {
  await api.delete(`${basePath}/documents/${id}`);
}

export function DocumentsFields({
  entries,
  onChange,
  basePath,
}: {
  entries: PartyDocumentEntry[];
  onChange: (entries: PartyDocumentEntry[]) => void;
  // When set (Edit mode, existing customer/supplier), an already-saved
  // document can be viewed, and removing it deletes it immediately.
  basePath?: string;
}) {
  const can = useCan();
  function update(key: string, patch: Partial<PartyDocumentEntry>) {
    onChange(entries.map((e) => (e._key === key ? { ...e, ...patch } : e)));
  }
  function addAnother() {
    onChange([...entries, emptyPartyDocument()]);
  }
  async function removeEntry(entry: PartyDocumentEntry) {
    if (entry.id && basePath) await deletePartyDocument(basePath, entry.id);
    onChange(entries.filter((e) => e._key !== entry._key));
  }

  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => (
        <div key={entry._key} className="border border-black/10 rounded-lg p-3 flex items-end gap-3">
          <div className="w-44 shrink-0">
            <Field label={`Document ${idx + 1} Type`}>
              <select
                className={inputClass}
                value={entry.docType}
                disabled={!!entry.id}
                onChange={(e) => update(entry._key, { docType: e.target.value })}
              >
                {PARTY_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex-1">
            {entry.id ? (
              <SecondaryButton
                icon={Paperclip}
                onClick={() => basePath && viewFile(`${basePath}/documents/${entry.id}`)}
              >
                {entry.originalName || 'View file'}
              </SecondaryButton>
            ) : (
              <DocumentFileUpload entry={entry} onFileSelected={(file) => update(entry._key, { file })} />
            )}
          </div>
          {/* removing a saved document is a DELETE (full); an unsaved one is just local */}
          {(!entry.id || !basePath || can('full')) && (
            <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => removeEntry(entry)} />
          )}
        </div>
      ))}
      <SecondaryButton icon={Plus} requires="edit" onClick={addAnother}>
        Add Another Document
      </SecondaryButton>
    </div>
  );
}

function DocumentFileUpload({ entry, onFileSelected }: { entry: PartyDocumentEntry; onFileSelected: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <SecondaryButton icon={Upload} requires="edit" onClick={() => inputRef.current?.click()}>
          {entry.file ? 'Change file' : 'Upload file'}
        </SecondaryButton>
        {entry.file && <span className="text-xs text-muted">{entry.file.name}</span>}
      </div>
    </div>
  );
}
