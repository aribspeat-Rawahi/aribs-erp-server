import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from '../api/client';
import { Card, PrimaryButton, SecondaryButton, inputClass } from './ui';
import { ApprovalBand, describeSteps } from './approvalInfo';

const ROLES: { value: string; label: string }[] = [
  { value: 'accountant', label: 'Accountant' },
  { value: 'md', label: 'MD' },
  { value: 'ceo', label: 'CEO' },
  { value: 'production', label: 'Production' },
  { value: 'sales', label: 'Sales' },
];
const DOCS: { key: 'purchase_order' | 'purchase_requisition'; label: string; hint: string }[] = [
  { key: 'purchase_order', label: 'Purchase orders', hint: 'by the order total incl. VAT' },
  { key: 'purchase_requisition', label: 'Purchase requisitions', hint: 'by the estimated total' },
];

interface EditBand {
  upTo: string; // '' = no limit
  steps: string[][];
}

// Settings > Approval rules: amount bands -> who approves (1-3 steps).
// Admin can always approve; nobody approves their own request.
export default function ApprovalRulesCard({ canEdit }: { canEdit: boolean }) {
  const [rules, setRules] = useState<Record<string, ApprovalBand[]> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [bands, setBands] = useState<EditBand[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/approval-rules').then((r) => setRules(r.data)).catch(() => setRules({}));
  }
  useEffect(load, []);

  function startEdit(key: string) {
    setEditing(key);
    setError('');
    setBands((rules?.[key] || []).map((b) => ({ upTo: b.upToAmount === null ? '' : String(b.upToAmount), steps: b.steps.map((s) => [...s]) })));
  }

  function toggleRole(bi: number, si: number, role: string) {
    setBands((prev) =>
      prev.map((b, i) =>
        i !== bi ? b : { ...b, steps: b.steps.map((s, j) => (j !== si ? s : s.includes(role) ? s.filter((r) => r !== role) : [...s, role])) },
      ),
    );
  }

  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.put(`/approval-rules/${editing}`, {
        bands: bands.map((b) => ({ upToAmount: b.upTo === '' ? null : Number(b.upTo), steps: b.steps })),
      });
      setEditing(null);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save the rules.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 max-w-xl mt-5">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink mb-1">
        <ShieldCheck size={15} />
        Approval rules
      </div>
      <p className="text-xs text-muted mb-4">
        Who must approve before a purchase goes ahead. Any one person with a listed role approves a step; with two steps, two different people.
        Admin can approve any step. Nobody can approve their own request. No band = no approval needed.
      </p>
      {!rules ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <div className="space-y-4">
          {DOCS.map((d) => (
            <div key={d.key} className="rounded-lg border border-black/10 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-sm font-medium text-ink">{d.label}</div>
                  <div className="text-xs text-muted">{d.hint}</div>
                </div>
                {canEdit && editing !== d.key && <SecondaryButton onClick={() => startEdit(d.key)}>Edit</SecondaryButton>}
              </div>
              {editing !== d.key ? (
                (rules[d.key] || []).length === 0 ? (
                  <div className="text-xs text-muted">No approval needed.</div>
                ) : (
                  <ul className="text-sm text-ink/80 space-y-1">
                    {(rules[d.key] || []).map((b, i, all) => {
                      const from = i === 0 ? 0 : all[i - 1].upToAmount;
                      return (
                        <li key={i} className="flex flex-wrap justify-between gap-2">
                          <span className="text-muted">
                            {b.upToAmount === null ? (from ? `Above ${Number(from).toLocaleString()} OMR` : 'Any amount') : `Up to ${Number(b.upToAmount).toLocaleString()} OMR`}
                          </span>
                          <span>{describeSteps(b.steps)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <div className="space-y-3">
                  {bands.map((b, bi) => (
                    <div key={bi} className="rounded-lg bg-black/[0.03] p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted w-16">Up to</span>
                        <input
                          className={inputClass}
                          type="number"
                          min="0.001"
                          step="0.001"
                          placeholder="No limit"
                          value={b.upTo}
                          onChange={(e) => setBands((p) => p.map((x, i) => (i === bi ? { ...x, upTo: e.target.value } : x)))}
                        />
                        <span className="text-xs text-muted">OMR</span>
                        <button type="button" className="text-muted hover:text-red-600 px-1" title="Remove band" onClick={() => setBands((p) => p.filter((_, i) => i !== bi))}>
                          &times;
                        </button>
                      </div>
                      {b.steps.map((s, si) => (
                        <div key={si} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-xs text-muted w-16">Step {si + 1}</span>
                          {ROLES.map((r) => (
                            <label key={r.value} className="flex items-center gap-1 text-xs text-ink">
                              <input type="checkbox" checked={s.includes(r.value)} onChange={() => toggleRole(bi, si, r.value)} />
                              {r.label}
                            </label>
                          ))}
                          {b.steps.length > 1 && (
                            <button type="button" className="text-xs text-red-600" onClick={() => setBands((p) => p.map((x, i) => (i === bi ? { ...x, steps: x.steps.filter((_, j) => j !== si) } : x)))}>
                              remove step
                            </button>
                          )}
                        </div>
                      ))}
                      {b.steps.length < 3 && (
                        <button type="button" className="text-xs text-brand-700" onClick={() => setBands((p) => p.map((x, i) => (i === bi ? { ...x, steps: [...x.steps, []] } : x)))}>
                          + add a step
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="text-xs text-brand-700" onClick={() => setBands((p) => [...p, { upTo: '', steps: [['md']] }])}>
                    + add an amount band
                  </button>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <SecondaryButton onClick={() => setEditing(null)}>Cancel</SecondaryButton>
                    <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
