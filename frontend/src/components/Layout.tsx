import { ReactNode, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

        <main className="flex-1 px-4 py-4 sm:px-8 sm:py-6 max-w-[1400px] w-full min-w-0">{children}</main>
      </div>
    </div>
  );
}
