import { FormEvent, useState } from 'react';
import api from '../api/client';
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui';

// The signed-in user's own password. Other sign-ins of the account stop
// working; this browser gets a fresh token so it stays signed in.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('The new password needs at least 8 characters.');
    if (next !== again) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      const res = await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      if (res.data?.accessToken) localStorage.setItem('erp_token', res.data.accessToken);
      setDone(true);
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? m.join(' ') : m || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-green-800">Password changed. You stay signed in here; other devices must sign in again with the new password.</p>
          <div className="flex justify-end">
            <PrimaryButton onClick={onClose}>Close</PrimaryButton>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Current password">
            <input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password (at least 8 characters)">
            <input className={inputClass} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="New password again">
            <input className={inputClass} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Team page: give someone a new password (they are signed out everywhere).
export function SetPasswordModal({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('The password needs at least 8 characters.');
    setBusy(true);
    try {
      await api.patch(`/auth/users/${user.id}/password`, { newPassword: next });
      setDone(true);
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? m.join(' ') : m || 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`New password - ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-green-800">Done. Give {user.name} the new password; they are signed out on every device and sign in with it.</p>
          <div className="flex justify-end">
            <PrimaryButton onClick={onClose}>Close</PrimaryButton>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="New password (at least 8 characters)">
            <input className={inputClass} type="text" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
