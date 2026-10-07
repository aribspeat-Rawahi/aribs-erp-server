import { useEffect, useState } from 'react';
import api from '../api/client';
import { Field, inputClass } from './ui';

export interface BankAccountOption {
  id: string;
  name: string;
  type?: string; // 'bank' | 'cash'
  currentBalance?: number | string;
}

// The bank / cash account money is paid from or received into. Required:
// every payment must move a real account, or it never reaches the books.
// Picks a sensible default (Cash for cash payments, else the first bank).
export default function BankAccountSelect({
  value,
  onChange,
  label = 'Paid from account',
  accounts,
  prefer,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  accounts?: BankAccountOption[]; // omit to load them here
  prefer?: 'cash' | 'bank';
}) {
  const [loaded, setLoaded] = useState<BankAccountOption[]>(accounts || []);

  useEffect(() => {
    if (accounts) {
      setLoaded(accounts);
      return;
    }
    api
      .get('/bank-accounts')
      .then((res) => setLoaded(res.data))
      .catch(() => setLoaded([]));
  }, [accounts]);

  // default / follow the payment type until the user picks one themselves
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !loaded.length) return;
    const wanted = prefer ? loaded.find((a) => (a.type || 'bank') === prefer) : undefined;
    const pick = wanted || loaded[0];
    if (pick && pick.id !== value) onChange(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, prefer, touched]);

  return (
    <Field label={label}>
      <select
        className={inputClass}
        value={value}
        onChange={(e) => {
          setTouched(true);
          onChange(e.target.value);
        }}
        required
      >
        <option value="">Choose bank / cash account</option>
        {loaded.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.currentBalance !== undefined ? ` (${Number(a.currentBalance).toFixed(3)} OMR)` : ''}
          </option>
        ))}
      </select>
      {loaded.length === 0 && <span className="mt-1 block text-xs text-red-600">No bank or cash account yet - add one on Accounting &gt; Accounts.</span>}
    </Field>
  );
}
