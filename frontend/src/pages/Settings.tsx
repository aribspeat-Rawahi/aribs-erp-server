import { FormEvent, useEffect, useRef, useState } from 'react';
import { Upload, FileText, Eye, Pencil, Trash2, DatabaseBackup } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, PrimaryButton, SecondaryButton, IconButton, Modal, EmptyState, Field, inputClass } from '../components/ui';
import { TEMPLATE_OPTIONS } from '../constants';
import { viewFile, downloadFile } from '../api/docActions';
import { useAuth } from '../context/AuthContext';
import { Can } from '../components/Permission';
import { localISODate } from '../utils/dates';
import ApprovalRulesCard from '../components/ApprovalRulesCard';

interface CompanyDocument {
  id: string;
  title: string;
  originalName: string;
  uploadedAt: string;
}

interface SettingsData {
  logoPath?: string;
  companyName: string;
  companyVatin?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyNameArabic?: string | null;
  companyCrNumber?: string | null;
  companyEmail?: string | null;
  companyPoBox?: string | null;
  companyPostalCode?: string | null;
  companyCity?: string | null;
  companyCityArabic?: string | null;
  companyGsm?: string | null;
  defaultInvoiceTemplate: string;
  weeklyOffDays?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  attendanceGraceMinutes?: number;
  incomeTaxRatePercent?: number;
  spfEmployeeRatePercent?: number | string;
  spfEmployerRatePercent?: number | string;
  spfWageCeiling?: number | string;
  expatSavingsSchemeStart?: string | null;
  updatedAt?: string;
}

// 0 = Sunday … 6 = Saturday, matching JS Date#getDay() — kept in sync
// with the backend's Settings.weeklyOffDays comment.
const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// Public endpoint — no auth header needed, so a plain <img src> works.
// The updatedAt query param busts the browser's image cache after a
// re-upload (same URL would otherwise keep showing the old logo).
export function logoUrl(updatedAt?: string) {
  return `${api.defaults.baseURL}/settings/logo?v=${encodeURIComponent(updatedAt || '')}`;
}

interface OffsiteStatus {
  configured: boolean;
  missingSettings: string[];
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSizeBytes: number | null;
  lastError: string | null;
}

export default function Settings() {
  // Database backup/restore is Admin-only on the server (CEO/MD can open
  // Settings but not the backup tools), so only Admin sees that card.
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Company Documents (trade license, VAT certificate, etc.)
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState('');
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [editingDoc, setEditingDoc] = useState<CompanyDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Database Backup — downloads a full .sql dump (schema + data) of the
  // live database, streamed straight from the backend (nothing saved on
  // the server). Admin-only, same as the rest of this page.
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState('');

  async function onDownloadBackup() {
    setBackingUp(true);
    setBackupError('');
    try {
      const stamp = localISODate();
      await downloadFile('/backup/download', `erp-backup-${stamp}.sql`);
    } catch {
      setBackupError('Backup failed — please try again, or check that the server can reach the database.');
    } finally {
      setBackingUp(false);
    }
  }

  // Automatic nightly backups — a list of what the server has already
  // saved on its own (see backend BackupService.runScheduledBackup), so
  // an admin can grab one without needing FTP/server access.
  const [scheduledBackups, setScheduledBackups] = useState<{ filename: string; sizeBytes: number; createdAt: string }[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(true);
  const [scheduledDownloading, setScheduledDownloading] = useState<string | null>(null);

  function loadScheduledBackups() {
    setScheduledLoading(true);
    api
      .get('/backup/scheduled')
      .then((res) => setScheduledBackups(res.data))
      .finally(() => setScheduledLoading(false));
  }

  useEffect(() => {
    if (isAdmin) loadScheduledBackups();
  }, [isAdmin]);

  // Off-site backup (encrypted copy in Cloudflare R2): status + "Back up now".
  const [offsite, setOffsite] = useState<OffsiteStatus | null>(null);
  const [offsiteError, setOffsiteError] = useState('');

  function loadOffsiteStatus() {
    api
      .get<OffsiteStatus>('/backup/offsite/status')
      .then((res) => setOffsite(res.data))
      .catch(() => setOffsite(null));
  }

  useEffect(() => {
    if (isAdmin) loadOffsiteStatus();
  }, [isAdmin]);

  // While a backup is running, check again every few seconds.
  useEffect(() => {
    if (!offsite?.running) return;
    const timer = window.setTimeout(loadOffsiteStatus, 4000);
    return () => window.clearTimeout(timer);
  }, [offsite]);

  // Error alerts: "Send test email" checks the email settings end to end.
  const [testAlertMsg, setTestAlertMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingAlert, setTestingAlert] = useState(false);

  async function onTestAlert() {
    setTestingAlert(true);
    setTestAlertMsg(null);
    try {
      const res = await api.post<{ sentTo: string[] }>('/monitoring/test-alert');
      setTestAlertMsg({ ok: true, text: `Test email sent to ${res.data.sentTo.join(', ')}. Check the inbox (and spam folder).` });
    } catch (err: any) {
      setTestAlertMsg({ ok: false, text: err?.response?.data?.message || 'Could not send the test email.' });
    } finally {
      setTestingAlert(false);
    }
  }

  async function onRunOffsite() {
    setOffsiteError('');
    try {
      await api.post('/backup/offsite/run');
      loadOffsiteStatus();
    } catch (err: any) {
      setOffsiteError(err?.response?.data?.message || 'Could not start the off-site backup.');
    }
  }

  async function onDownloadScheduled(filename: string) {
    setScheduledDownloading(filename);
    try {
      await downloadFile(`/backup/scheduled/${encodeURIComponent(filename)}`, filename);
    } finally {
      setScheduledDownloading(null);
    }
  }

  function formatBackupSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Restore — DESTRUCTIVE: replaces every row in the database with the
  // uploaded backup's contents. Gated behind a confirm modal that
  // requires typing "RESTORE" exactly, on top of the backend's own
  // automatic safety-backup + auto-rollback-on-failure.
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoreNotice, setRestoreNotice] = useState('');

  function onRestoreFileSelected(file: File) {
    setRestoreFile(file);
    setConfirmText('');
    setRestoreError('');
    setRestoreNotice('');
    setConfirmingRestore(true);
  }

  function closeRestoreModal() {
    setConfirmingRestore(false);
    setRestoreFile(null);
    setConfirmText('');
    setRestorePassword('');
    if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
  }

  async function onConfirmRestore() {
    if (!restoreFile || confirmText !== 'RESTORE' || !restorePassword) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const formData = new FormData();
      formData.append('confirm', confirmText);
      formData.append('password', restorePassword);
      formData.append('file', restoreFile);
      const res = await api.post('/backup/restore', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setRestoreNotice(
        `Restore complete. A safety backup of the data just before this restore was saved on the server as "${res.data.safetyBackupFilename}".`,
      );
      setConfirmingRestore(false);
      setRestoreFile(null);
      setConfirmText('');
      setRestorePassword('');
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    } catch (err: any) {
      setRestoreError(err?.response?.data?.message || 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  }

  function load() {
    setLoading(true);
    api.get('/settings').then((res) => setSettings(res.data)).finally(() => setLoading(false));
  }

  function loadDocuments() {
    setDocsLoading(true);
    api.get('/settings/documents').then((res) => setDocuments(res.data)).finally(() => setDocsLoading(false));
  }

  useEffect(load, []);
  useEffect(loadDocuments, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.patch('/settings', {
        companyName: settings.companyName,
        companyVatin: settings.companyVatin || undefined,
        companyAddress: settings.companyAddress || undefined,
        companyPhone: settings.companyPhone || undefined,
        companyNameArabic: settings.companyNameArabic ?? undefined,
        companyCrNumber: settings.companyCrNumber ?? undefined,
        companyEmail: settings.companyEmail ?? undefined,
        companyPoBox: settings.companyPoBox ?? undefined,
        companyPostalCode: settings.companyPostalCode ?? undefined,
        companyCity: settings.companyCity ?? undefined,
        companyCityArabic: settings.companyCityArabic ?? undefined,
        companyGsm: settings.companyGsm ?? undefined,
        defaultInvoiceTemplate: settings.defaultInvoiceTemplate,
        weeklyOffDays: settings.weeklyOffDays ?? '',
        shiftStartTime: settings.shiftStartTime || undefined,
        shiftEndTime: settings.shiftEndTime || undefined,
        attendanceGraceMinutes:
          settings.attendanceGraceMinutes !== undefined && settings.attendanceGraceMinutes !== null
            ? Number(settings.attendanceGraceMinutes)
            : undefined,
        incomeTaxRatePercent:
          settings.incomeTaxRatePercent !== undefined && settings.incomeTaxRatePercent !== null
            ? Number(settings.incomeTaxRatePercent)
            : undefined,
        spfEmployeeRatePercent: settings.spfEmployeeRatePercent !== undefined ? Number(settings.spfEmployeeRatePercent) : undefined,
        spfEmployerRatePercent: settings.spfEmployerRatePercent !== undefined ? Number(settings.spfEmployerRatePercent) : undefined,
        spfWageCeiling: settings.spfWageCeiling !== undefined ? Number(settings.spfWageCeiling) : undefined,
        expatSavingsSchemeStart: settings.expatSavingsSchemeStart || undefined,
      });
      setNotice('Saved.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function onLogoSelected(file: File) {
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/settings/logo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setLogoFailed(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not upload the logo.');
    } finally {
      setUploading(false);
    }
  }

  async function onDocFileSelected(file: File) {
    if (!newDocTitle.trim()) {
      setDocError('Enter a title before choosing a file.');
      if (docFileInputRef.current) docFileInputRef.current.value = '';
      return;
    }
    setUploadingDoc(true);
    setDocError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', newDocTitle.trim());
      await api.post('/settings/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNewDocTitle('');
      loadDocuments();
    } catch (err: any) {
      setDocError(err?.response?.data?.message || 'Could not upload the document.');
    } finally {
      setUploadingDoc(false);
      if (docFileInputRef.current) docFileInputRef.current.value = '';
    }
  }

  async function saveEditDoc(e: FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    setSavingEdit(true);
    try {
      await api.patch(`/settings/documents/${editingDoc.id}`, { title: editTitle.trim() });
      setEditingDoc(null);
      loadDocuments();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not rename this document.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeDocument(doc: CompanyDocument) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/settings/documents/${doc.id}`);
      loadDocuments();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this document.');
    }
  }

  if (loading || !settings) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Company details shown on invoices, quotations, and delivery notes" />

      <Card className="p-5 max-w-xl">
        <div className="mb-5">
          <span className="block text-xs font-medium text-muted mb-2">Company logo</span>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden">
              {settings.logoPath && !logoFailed ? (
                <img
                  src={logoUrl(settings.updatedAt)}
                  alt="Company logo"
                  className="w-full h-full object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <span className="text-xs text-muted">No logo</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onLogoSelected(e.target.files[0])}
            />
            <SecondaryButton icon={Upload} requires="edit" onClick={() => fileInputRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload logo'}
            </SecondaryButton>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Company name">
            <input
              className={inputClass}
              value={settings.companyName}
              onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VATIN">
              <input
                className={inputClass}
                value={settings.companyVatin || ''}
                onChange={(e) => setSettings({ ...settings, companyVatin: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputClass}
                value={settings.companyPhone || ''}
                onChange={(e) => setSettings({ ...settings, companyPhone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              className={inputClass}
              value={settings.companyAddress || ''}
              onChange={(e) => setSettings({ ...settings, companyAddress: e.target.value })}
              placeholder="e.g. P.O. Box 123, P.C. 611, Nizwa"
            />
          </Field>
          <Field label="Company name in Arabic (letterhead of purchasing documents, e.g. RFQ)">
            <input
              className={inputClass}
              dir="rtl"
              maxLength={200}
              value={settings.companyNameArabic || ''}
              onChange={(e) => setSettings({ ...settings, companyNameArabic: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="C.R. No.">
              <input
                className={inputClass}
                maxLength={40}
                value={settings.companyCrNumber || ''}
                onChange={(e) => setSettings({ ...settings, companyCrNumber: e.target.value })}
              />
            </Field>
            <Field label="Company email">
              <input
                className={inputClass}
                type="email"
                maxLength={120}
                value={settings.companyEmail || ''}
                onChange={(e) => setSettings({ ...settings, companyEmail: e.target.value })}
              />
            </Field>
          </div>
          <div className="text-xs text-muted pt-1">Letterhead of RFQs - shown in English and Arabic (Arabic digits are filled in automatically)</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="P.O. Box">
              <input
                className={inputClass}
                maxLength={20}
                value={settings.companyPoBox || ''}
                onChange={(e) => setSettings({ ...settings, companyPoBox: e.target.value })}
              />
            </Field>
            <Field label="P.C. (postal code)">
              <input
                className={inputClass}
                maxLength={10}
                value={settings.companyPostalCode || ''}
                onChange={(e) => setSettings({ ...settings, companyPostalCode: e.target.value })}
              />
            </Field>
            <Field label="City">
              <input
                className={inputClass}
                maxLength={80}
                value={settings.companyCity || ''}
                onChange={(e) => setSettings({ ...settings, companyCity: e.target.value })}
              />
            </Field>
            <Field label="City in Arabic">
              <input
                className={inputClass} dir="rtl"
                maxLength={80}
                value={settings.companyCityArabic || ''}
                onChange={(e) => setSettings({ ...settings, companyCityArabic: e.target.value })}
              />
            </Field>
            <Field label="GSM">
              <input
                className={inputClass}
                maxLength={30}
                value={settings.companyGsm || ''}
                onChange={(e) => setSettings({ ...settings, companyGsm: e.target.value })}
              />
            </Field>
          </div>

          <div>
            <span className="block text-xs font-medium text-muted mb-2">Weekly off days</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((d) => {
                const selected = (settings.weeklyOffDays || '')
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .includes(String(d.value));
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => {
                      const current = (settings.weeklyOffDays || '')
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean);
                      const next = selected
                        ? current.filter((v) => v !== String(d.value))
                        : [...current, String(d.value)];
                      setSettings({ ...settings, weeklyOffDays: next.join(',') });
                    }}
                    className={`w-11 h-9 rounded-lg border text-xs font-medium transition-colors ${
                      selected ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-black/10 text-ink/70 hover:bg-black/5'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted mt-1.5">HR Attendance will flag these days as "Weekly Off".</p>
          </div>

          <div>
            <span className="block text-xs font-medium text-muted mb-2">Work shift & attendance rule</span>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Shift starts">
                <input
                  className={inputClass}
                  type="time"
                  value={settings.shiftStartTime || ''}
                  onChange={(e) => setSettings({ ...settings, shiftStartTime: e.target.value })}
                />
              </Field>
              <Field label="Shift ends">
                <input
                  className={inputClass}
                  type="time"
                  value={settings.shiftEndTime || ''}
                  onChange={(e) => setSettings({ ...settings, shiftEndTime: e.target.value })}
                />
              </Field>
              <Field label="Grace (minutes)">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={settings.attendanceGraceMinutes ?? 15}
                  onChange={(e) => setSettings({ ...settings, attendanceGraceMinutes: Number(e.target.value) })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted mt-1.5">
              A check-in within the grace period of shift start counts as on-time; a check-out within the grace
              period of shift end isn't overtime. Beyond that, the full time counts as late / overtime. Used for
              both manual attendance and fingerprint/biometric device punches.
            </p>
          </div>

          <div>
            <span className="block text-xs font-medium text-muted mb-2">Accounting</span>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Income tax rate (%)">
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={settings.incomeTaxRatePercent ?? 15}
                  onChange={(e) => setSettings({ ...settings, incomeTaxRatePercent: Number(e.target.value) })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted mt-1.5">
              Oman's standard corporate rate is 15% — change this if your accountant confirms a different rate or
              threshold applies. Used by the monthly Income Tax Provision that auto-posts against year-to-date net
              profit (Accounting tab → Journals).
            </p>
          </div>

          <div>
            <span className="block text-xs font-medium text-muted mb-2">Payroll - Social Protection Fund &amp; gratuity</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="SPF employee share (%)">
                <input className={inputClass} type="number" step="0.01" min="0" max="100" value={settings.spfEmployeeRatePercent ?? 8} onChange={(e) => setSettings({ ...settings, spfEmployeeRatePercent: e.target.value })} />
              </Field>
              <Field label="SPF employer share (%)">
                <input className={inputClass} type="number" step="0.01" min="0" max="100" value={settings.spfEmployerRatePercent ?? 13.5} onChange={(e) => setSettings({ ...settings, spfEmployerRatePercent: e.target.value })} />
              </Field>
              <Field label="SPF wage ceiling (OMR/month)">
                <input className={inputClass} type="number" step="0.001" min="0" value={settings.spfWageCeiling ?? 3000} onChange={(e) => setSettings({ ...settings, spfWageCeiling: e.target.value })} />
              </Field>
              <Field label="Expat savings scheme starts">
                <input className={inputClass} type="date" value={settings.expatSavingsSchemeStart || ''} onChange={(e) => setSettings({ ...settings, expatSavingsSchemeStart: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs text-muted mt-1.5">
              Omani staff (Social Protection Fund): the employee share is deducted from pay, the employer share is a cost - confirm both rates with the
              SPF or your accountant. Expatriate staff accrue end-of-service gratuity on basic salary (old law up to 30 Jul 2023, then one month a year)
              until the savings scheme starts.
            </p>
          </div>

          <div>
            <span className="block text-xs font-medium text-muted mb-2">Default PDF template</span>
            <div className="space-y-2">
              {TEMPLATE_OPTIONS.map((t) => (
                <label
                  key={t.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                    settings.defaultInvoiceTemplate === t.value ? 'border-brand-500 bg-brand-50/40' : 'border-black/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    className="mt-1"
                    checked={settings.defaultInvoiceTemplate === t.value}
                    onChange={() => setSettings({ ...settings, defaultInvoiceTemplate: t.value })}
                  />
                  <div>
                    <div className="text-sm font-medium text-ink">{t.label}</div>
                    <div className="text-xs text-muted">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-brand-700">{notice}</p>}
          <div className="flex justify-end pt-2">
            <PrimaryButton type="submit" requires="edit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="p-5 max-w-xl mt-5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-1">
          <FileText size={15} />
          Company Documents
        </div>
        <p className="text-xs text-muted mb-4">
          Trade license, VAT certificate, CR paper, or any other company paperwork — upload as many as you need.
        </p>

        <Can>
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <Field label="Document title">
              <input
                className={inputClass}
                placeholder="e.g. Trade License"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
              />
            </Field>
          </div>
          <input
            ref={docFileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onDocFileSelected(e.target.files[0])}
          />
          <SecondaryButton icon={Upload} onClick={() => docFileInputRef.current?.click()}>
            {uploadingDoc ? 'Uploading…' : 'Upload'}
          </SecondaryButton>
        </div>
        </Can>
        {docError && <p className="text-sm text-red-600 mb-3">{docError}</p>}

        {docsLoading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : documents.length === 0 ? (
          <EmptyState>No documents uploaded yet.</EmptyState>
        ) : (
          <div className="divide-y divide-black/5">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{doc.title}</div>
                  <div className="text-xs text-muted truncate">
                    {doc.originalName} &middot; {new Date(doc.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <IconButton icon={Eye} title="View" onClick={() => viewFile(`/settings/documents/${doc.id}`)} />
                  <IconButton
                    icon={Pencil}
                    requires="edit"
                    title="Edit"
                    onClick={() => {
                      setEditingDoc(doc);
                      setEditTitle(doc.title);
                    }}
                  />
                  <IconButton icon={Trash2} title="Delete" tone="danger" requires="full" onClick={() => removeDocument(doc)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ApprovalRulesCard canEdit={['admin', 'ceo', 'md'].includes(user?.role || '')} />

      {isAdmin && (
      <Card className="mt-5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-1">
          <DatabaseBackup size={16} />
          Database Backup
        </div>
        <p className="text-xs text-muted mb-3">
          Download a full snapshot of the database (every customer, invoice, payment, and setting) as a .sql file —
          take one before any update or deployment.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={onDownloadBackup} disabled={backingUp}>
            {backingUp ? 'Preparing backup…' : 'Download Backup'}
          </PrimaryButton>
          {backupError && <span className="text-xs text-red-600">{backupError}</span>}
        </div>

        <div className="mt-5 pt-4 border-t border-black/10">
          <div className="text-sm font-semibold text-ink mb-1">Automatic Nightly Backups</div>
          <p className="text-xs text-muted mb-3">
            The server saves a full backup on its own every night at 3:00 AM, and keeps the last 14 automatically —
            no action needed, but you can download any of them here.
          </p>
          {scheduledLoading ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : scheduledBackups.length === 0 ? (
            <p className="text-xs text-muted">No automatic backup yet — the first one is taken tonight at 3:00 AM.</p>
          ) : (
            <div className="space-y-1.5">
              {scheduledBackups.map((b) => (
                <div key={b.filename} className="flex items-center justify-between gap-3 text-xs bg-black/[0.03] rounded-lg px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">{new Date(b.createdAt).toLocaleString()}</span>
                    <span className="text-muted">{formatBackupSize(b.sizeBytes)}</span>
                  </div>
                  <SecondaryButton onClick={() => onDownloadScheduled(b.filename)} disabled={scheduledDownloading === b.filename}>
                    {scheduledDownloading === b.filename ? 'Downloading…' : 'Download'}
                  </SecondaryButton>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-black/10">
          <div className="text-sm font-semibold text-ink mb-1">Off-site Backup (Cloudflare R2)</div>
          <p className="text-xs text-muted mb-3">
            Every night an encrypted copy of the database and all uploaded files is also stored outside this server,
            so the data survives even if the hosting account is lost. Copies are kept for 30 days.
          </p>
          {!offsite ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : !offsite.configured ? (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Not set up on this server yet. Missing settings: {offsite.missingSettings.join(', ')}.
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-black/[0.03] rounded-lg px-3 py-2">
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-ink">
                    {offsite.running
                      ? 'Backing up now…'
                      : offsite.lastSuccessAt
                        ? `Last successful: ${new Date(offsite.lastSuccessAt).toLocaleString()}`
                        : 'No off-site backup yet'}
                  </span>
                  {offsite.lastSuccessAt && offsite.lastSizeBytes != null && !offsite.running && (
                    <span className="text-muted break-all">
                      {formatBackupSize(offsite.lastSizeBytes)} · {offsite.lastFile}
                    </span>
                  )}
                </div>
                <SecondaryButton onClick={onRunOffsite} disabled={offsite.running}>
                  {offsite.running ? 'Running…' : 'Back up now'}
                </SecondaryButton>
              </div>
              {offsite.lastError && !offsite.running && (
                <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 break-words">
                  Last attempt failed ({offsite.lastAttemptAt ? new Date(offsite.lastAttemptAt).toLocaleString() : '-'}):{' '}
                  {offsite.lastError}
                </p>
              )}
            </div>
          )}
          {offsiteError && <p className="text-xs text-red-600 mt-2">{offsiteError}</p>}
        </div>

        <div className="mt-5 pt-4 border-t border-black/10">
          <div className="text-sm font-semibold text-ink mb-1">Error Alerts</div>
          <p className="text-xs text-muted mb-3">
            When something breaks (server errors, failed nightly jobs or backups, page crashes in the app) an email goes
            to the addresses set in ERROR_ALERT_EMAILS. Use this button to check that emails really arrive.
          </p>
          <SecondaryButton onClick={onTestAlert} disabled={testingAlert}>
            {testingAlert ? 'Sending…' : 'Send test email'}
          </SecondaryButton>
          {testAlertMsg && (
            <p className={`text-xs mt-2 rounded-lg px-3 py-2 break-words ${testAlertMsg.ok ? 'text-brand-700 bg-brand-50' : 'text-red-600 bg-red-50'}`}>
              {testAlertMsg.text}
            </p>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-black/10">
          <div className="text-sm font-semibold text-red-700 mb-1">Restore from Backup</div>
          <p className="text-xs text-muted mb-3">
            This replaces every record currently in the database with the contents of the uploaded .sql file — all
            data added since that backup will be lost. Only use this for disaster recovery.
          </p>
          <input
            ref={restoreFileInputRef}
            type="file"
            accept=".sql"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onRestoreFileSelected(e.target.files[0])}
          />
          <SecondaryButton onClick={() => restoreFileInputRef.current?.click()}>Choose Backup File…</SecondaryButton>
          {restoreNotice && <p className="text-xs text-brand-700 mt-2">{restoreNotice}</p>}
        </div>
      </Card>
      )}

      {confirmingRestore && restoreFile && (
        <Modal title="Confirm database restore" onClose={closeRestoreModal}>
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold mb-1">This cannot be undone from here.</p>
              <p>
                Restoring <span className="font-mono">{restoreFile.name}</span> will <strong>delete every current
                row</strong> in the database and replace it with this file's contents. A safety backup of the
                current data is taken automatically first, and if the restore itself fails it is rolled back
                automatically — but a successful restore permanently replaces today's data with the backup's data.
              </p>
            </div>
            <Field label={'Type RESTORE to confirm'}>
              <input
                className={inputClass}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESTORE"
                autoFocus
              />
            </Field>
            <Field label="Your password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
              />
            </Field>
            {restoreError && <p className="text-xs text-red-600">{restoreError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={closeRestoreModal} disabled={restoring}>
                Cancel
              </SecondaryButton>
              <PrimaryButton
                onClick={onConfirmRestore}
                disabled={confirmText !== 'RESTORE' || !restorePassword || restoring}
                className="!bg-red-600 hover:!bg-red-700"
              >
                {restoring ? 'Restoring…' : 'Restore and overwrite all data'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {editingDoc && (
        <Modal title="Rename document" onClose={() => setEditingDoc(null)}>
          <form onSubmit={saveEditDoc} className="space-y-3">
            <Field label="Document title">
              <input className={inputClass} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setEditingDoc(null)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" requires="edit" disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
