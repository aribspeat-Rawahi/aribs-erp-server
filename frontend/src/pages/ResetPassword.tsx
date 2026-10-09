import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { inputClass } from '../components/ui';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-xl shadow-sm p-7">
        <h1 className="text-lg font-semibold mb-4">{title}</h1>
        {children}
        <p className="text-xs text-center mt-5">
          <Link to="/login" className="text-brand-600 font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

const btn = 'w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-ink text-sm font-medium py-2.5 rounded-lg transition-colors';

// "Forgot password?" - asks for the email and sends a one-hour link.
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err: any) {
      setError(err?.response?.status === 429 ? 'Too many tries - wait a minute.' : 'Could not send the link. Check the email address.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Forgot password">
      {sent ? (
        <p className="text-sm text-ink/80">If this email has an account, a link to set a new password has been sent to it. It works for 1 hour.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <p className="text-sm text-muted">Enter your account email. We'll email you a link to set a new password.</p>
          <input className={inputClass} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className={btn}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="text-xs text-muted">No email arriving? An Admin can also set a new password for you in Admin → Team.</p>
        </form>
      )}
    </Shell>
  );
}

// The page the emailed link opens: /reset-password?token=...
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('The password needs at least 8 characters.');
    if (next !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: next });
      setDone(true);
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? 'This reset link is invalid or has expired. Ask for a new one.' : m || 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Set a new password">
      {!token ? (
        <p className="text-sm text-red-600">This link is incomplete. Open the link from the email again, or ask for a new one.</p>
      ) : done ? (
        <p className="text-sm text-green-800">Your password was changed. Sign in with the new password.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <input className={inputClass} type="password" autoComplete="new-password" placeholder="New password (at least 8 characters)" value={next} onChange={(e) => setNext(e.target.value)} required />
          <input className={inputClass} type="password" autoComplete="new-password" placeholder="New password again" value={again} onChange={(e) => setAgain(e.target.value)} required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className={btn}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}
    </Shell>
  );
}
