import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import api from '../api/client';
import { DEFAULT_MODULE_ROLES } from '../constants';

export type Role = 'admin' | 'ceo' | 'md' | 'accountant' | 'production' | 'sales';
export type ModuleAccessLevel = 'none' | 'view' | 'edit' | 'full';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  modulePermissions?: Partial<Record<string, ModuleAccessLevel>> | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role?: Role) => Promise<void>;
  logout: () => void;
  hasAnyRole: (roles: Role[]) => boolean;
  // Whether the current user can see/open a given module (a left-menu
  // area, keyed the same as MODULE_OPTIONS in constants.ts). Admin/CEO/MD
  // always pass — they're trusted with full access regardless of any
  // per-module overrides. For everyone else: an explicit override on
  // their account wins (an explicit 'none' hides it even if their role
  // would normally show it, and any other explicit level shows it even
  // if their role normally wouldn't); with no override for that module,
  // today's existing role-based default applies unchanged.
  canAccessModule: (moduleKey: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('erp_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('erp_user');
      }
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, user: loggedInUser } = res.data;
    localStorage.setItem('erp_token', accessToken);
    localStorage.setItem('erp_user', JSON.stringify(loggedInUser));
    setUser(loggedInUser);
  }

  async function register(name: string, email: string, password: string, role?: Role) {
    await api.post('/auth/register', { name, email, password, role });
    await login(email, password);
  }

  function logout() {
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_user');
    setUser(null);
  }

  function hasAnyRole(roles: Role[]) {
    if (!user) return false;
    return roles.includes(user.role);
  }

  function canAccessModule(moduleKey: string) {
    if (!user) return false;
    if (['admin', 'ceo', 'md'].includes(user.role)) return true;

    const override = user.modulePermissions?.[moduleKey];
    if (override) return override !== 'none';

    const defaultRoles = DEFAULT_MODULE_ROLES[moduleKey];
    if (defaultRoles === undefined) return true; // unknown module key — fail open, not closed
    if (defaultRoles === null) return true; // any authenticated user
    return defaultRoles.includes(user.role);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, hasAnyRole, canAccessModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
