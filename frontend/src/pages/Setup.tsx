import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inputClass } from '../components/ui';
import api from '../api/client';
import { logoUrl } from './Settings';

// Bootstrap flow: only meaningful the very first time, before any user
// exists — the backend forces every later self-registration to the Sales
// role regardless of what's sent here (see AuthService.register).
export default function Setup() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [companyName, setCompanyName] = useState('ARIBS ERP');
  const [hasLogo, setHasLogo] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoVersion, setLogoVersion] = useState<string | undefined>(undefined);

  useEffect(() => {
    api.get('/settings').then((res) => {
      setCompanyName(res.data.companyName || 'ARIBS ERP');
      setHasLogo(!!res.data.logoPath);
      setLogoVersion(res.data.updatedAt);
    });
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(name, email, password, 'admin');
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-xl shadow-sm p-7">
        <div className="flex items-center gap-2 mb-6">
          {hasLogo && !logoFailed ? (
            <img
              src={logoUrl(logoVersion)}
              alt={companyName}
              className="w-8 h-8 rounded-full object-cover"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-ink">🌴</div>
          )}
          <span className="font-semibold text-lg">{companyName}</span>
        </div>
        <h1 className="text-lg font-semibold mb-1">Create the admin account</h1>
        <p className="text-sm text-muted mb-5">
          Only works once — for the very first user of this ERP.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input className={inputClass} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            className={inputClass}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-ink text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="text-xs text-muted mt-5 text-center">
          Already set up?{' '}
          <Link to="/login" className="text-brand-600 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
