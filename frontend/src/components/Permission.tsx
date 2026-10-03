import { createContext, ReactNode, useContext } from 'react';
import { useAuth } from '../context/AuthContext';

// What a button needs: 'edit' = add/change/approve, 'full' = delete.
// Matches the backend (roles.guard.ts): POST/PATCH need edit, DELETE needs full.
export type ActionLevel = 'edit' | 'full';

const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, full: 3 };

// The module of the page being shown (set by ProtectedRoute in App.tsx),
// so buttons don't have to repeat it. A button that acts on a DIFFERENT
// module (e.g. Approve on the Invoices page = "approvals") passes it.
export const PageModuleContext = createContext<string | undefined>(undefined);

export function useCan() {
  const { moduleLevel } = useAuth();
  const pageModule = useContext(PageModuleContext);
  return (need: ActionLevel = 'edit', module?: string) => {
    const key = module || pageModule;
    if (!key) return true; // not inside a module page - the server still checks
    return RANK[moduleLevel(key)] >= RANK[need];
  };
}

// Shows its children only if the user may do this. Usage:
//   <Can>...add/edit button...</Can>
//   <Can need="full">...delete button...</Can>
//   <Can module="approvals">...approve/reject...</Can>
export function Can({
  need = 'edit',
  module,
  children,
  fallback = null,
}: {
  need?: ActionLevel;
  module?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const can = useCan();
  return <>{can(need, module) ? children : fallback}</>;
}
