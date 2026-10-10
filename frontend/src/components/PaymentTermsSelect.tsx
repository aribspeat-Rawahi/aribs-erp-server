import { inputClass } from './ui';

// Payment terms in days; '' = none (the document's own due date decides).
export const PAYMENT_TERMS_OPTIONS = [
  { value: '', label: 'No terms' },
  { value: '0', label: 'Due at once (cash)' },
  { value: '7', label: 'Net 7 days' },
  { value: '15', label: 'Net 15 days' },
  { value: '30', label: 'Net 30 days' },
  { value: '45', label: 'Net 45 days' },
  { value: '60', label: 'Net 60 days' },
  { value: '90', label: 'Net 90 days' },
];

export function termsLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return '';
  return days === 0 ? 'Due at once' : `Net ${days} days`;
}

export function PaymentTermsSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = PAYMENT_TERMS_OPTIONS.some((o) => o.value === value);
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {PAYMENT_TERMS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {!known && <option value={value}>Net {value} days</option>}
    </select>
  );
}
