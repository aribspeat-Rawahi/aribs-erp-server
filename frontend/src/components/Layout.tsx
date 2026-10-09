import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, AlertTriangle } from 'lucide-react';
import Sidebar from './Sidebar';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { hasAnyRole } = useAuth();
  const location = useLocation();

  // While an opening date is set but not finalized nothing can be booked
  // (the backend refuses it) - say so up front instead of on every save.
  const [openingPending, setOpeningPending] = useState<string | null>(null);
  useEffect(() => {
    api
      .get('/settings')
      .then((res) => {
        const s = res.data || {};
        setOpeningPending(s.openingBalanceDate && !s.openingBalanceFinalizedAt ? String(s.openingBalanceDate).slice(0, 10) : null);
      })
      .catch(() => {});
  }, [location.pathname, location.search]);
  const canFinalize = hasAnyRole(['admin', 'accountant', 'ceo', 'md']);

  return (
    <div className="min-h-screen flex bg-cream">
      <Sidebar isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — mobile/tablet only; the sidebar itself is the header on desktop */}
        <header className="print:hidden lg:hidden flex items-center gap-3 px-4 h-14 bg-tan border-b border-black/10 shrink-0 sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            title="Menu"
            className="shrink-0 p-1.5 -ml-1.5 rounded-md text-tan-ink hover:bg-black/10 transition-colors"
          >
            <Menu size={20} strokeWidth={2} />
          </button>
          <span className="font-semibold text-[15px] tracking-tight text-tan-ink truncate">ARIBS ERP</span>
        </header>

        <main className="flex-1 px-4 py-4 sm:px-8 sm:py-6 max-w-[1400px] w-full min-w-0">
          {openingPending && (
            <div className="print:hidden mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Opening balances (as of {openingPending}) are not finalized yet. Invoices, payments, purchases, expenses and
                  payroll can't be recorded until they are.
                </span>
              </div>
              {canFinalize && (
                <Link
                  to="/accounting?tab=opening"
                  className="shrink-0 self-start rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 sm:self-auto"
                >
                  Go to Opening Balances
                </Link>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
