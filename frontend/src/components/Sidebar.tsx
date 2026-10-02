import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import api from '../api/client';
import { logoUrl } from '../pages/Settings';
import {
  LayoutGrid,
  Boxes,
  ShoppingCart,
  ChevronDown,
  Users,
  ShoppingBag,
  FileText,
  Truck,
  Receipt,
  Repeat,
  ClipboardList,
  UserCog,
  Wallet,
  History,
  UsersRound,
  WalletCards,
  Hourglass,
  Settings as SettingsIcon,
  LogOut,
  ShieldCheck,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const linkBase =
  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors';
// Nav body is lime green (#75D056) — items are transparent by
// default with dark-green text/icons, and switch to an off-white
// background with dark ink text on hover or when active.
const linkInactive = 'text-sidebar-inactive hover:bg-white/90 hover:text-ink';
const linkActive = 'bg-white text-ink font-semibold';

function Item({
  to,
  icon: Icon,
  label,
  indent,
  onNavigate,
}: {
  to: string;
  icon: any;
  label: string;
  indent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) => `${linkBase} ${indent ? 'pl-8' : ''} ${isActive ? linkActive : linkInactive}`}
    >
      <Icon size={indent ? 15 : 17} strokeWidth={2} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation();
  const { logout, canAccessModule } = useAuth();
  const [salesOpen, setSalesOpen] = useState(location.pathname.startsWith('/sales') || ['/quotations', '/delivery-notes', '/invoices'].some((p) => location.pathname.startsWith(p)));
  const [crmOpen, setCrmOpen] = useState(['/customers', '/suppliers'].some((p) => location.pathname.startsWith(p)));
  const [paymentOpen, setPaymentOpen] = useState(['/payments', '/pending'].some((p) => location.pathname.startsWith(p)));
  const [adminOpen, setAdminOpen] = useState(['/activity-log', '/team', '/settings'].some((p) => location.pathname.startsWith(p)));

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

  return (
    <>
      {/* Backdrop — mobile/tablet only, shown while the drawer is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`print:hidden w-[216px] shrink-0 border-r border-black/10 min-h-screen flex flex-col
          fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0 lg:z-auto`}
      >
        <div className="flex items-center gap-2 px-4 h-14 bg-tan shrink-0">
          {hasLogo && !logoFailed ? (
            <img
              src={logoUrl(logoVersion)}
              alt={companyName}
              className="w-7 h-7 rounded-full object-cover"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-tan-ink flex items-center justify-center text-tan text-sm">
              🌴
            </div>
          )}
          <span className="font-semibold text-[15px] tracking-tight truncate text-tan-ink flex-1">{companyName}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            title="Refresh"
            className="shrink-0 p-1.5 rounded-md text-tan-ink hover:bg-black/10 transition-colors"
          >
            <RefreshCw size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close menu"
            className="shrink-0 p-1.5 rounded-md text-tan-ink hover:bg-black/10 transition-colors lg:hidden"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto bg-[#75D056]">
          {canAccessModule('dashboard') && <Item to="/" icon={LayoutGrid} label="Dashboard" onNavigate={onClose} />}
          {canAccessModule('inventory') && <Item to="/inventory" icon={Boxes} label="Inventory" onNavigate={onClose} /> }

        {(canAccessModule('sales_orders') ||
          canAccessModule('quotations') ||
          canAccessModule('delivery_notes') ||
          canAccessModule('invoices') ||
          canAccessModule('recurring_invoices')) && (
          <>
            <button
              onClick={() => setSalesOpen((v) => !v)}
              className={`${linkBase} ${linkInactive} w-full justify-between`}
            >
              <span className="flex items-center gap-2.5">
                <ShoppingCart size={17} />
                Sales
              </span>
              <ChevronDown size={15} className={`transition-transform ${salesOpen ? 'rotate-180' : ''}`} />
            </button>
            {salesOpen && (
              <div className="space-y-1">
                {canAccessModule('sales_orders') && <Item to="/sales-orders" icon={ShoppingBag} label="Sales Orders" indent onNavigate={onClose} />}
                {canAccessModule('quotations') && <Item to="/quotations" icon={FileText} label="Quotations" indent onNavigate={onClose} />}
                {canAccessModule('delivery_notes') && <Item to="/delivery-notes" icon={Truck} label="Delivery Notes" indent onNavigate={onClose} />}
                {canAccessModule('invoices') && <Item to="/invoices" icon={Receipt} label="Invoices" indent onNavigate={onClose} />}
                {canAccessModule('recurring_invoices') && <Item to="/recurring-invoices" icon={Repeat} label="Recurring Invoices" indent onNavigate={onClose} />}
              </div>
            )}
          </>
        )}

        {(canAccessModule('customers') || canAccessModule('suppliers')) && (
          <>
            <button
              onClick={() => setCrmOpen((v) => !v)}
              className={`${linkBase} ${linkInactive} w-full justify-between`}
            >
              <span className="flex items-center gap-2.5">
                <Users size={17} />
                CRM
              </span>
              <ChevronDown size={15} className={`transition-transform ${crmOpen ? 'rotate-180' : ''}`} />
            </button>
            {crmOpen && (
              <div className="space-y-1">
                {canAccessModule('customers') && <Item to="/customers" icon={Users} label="Customers" indent onNavigate={onClose} />}
                {canAccessModule('suppliers') && <Item to="/suppliers" icon={Truck} label="Suppliers" indent onNavigate={onClose} />}
              </div>
            )}
          </>
        )}

        {canAccessModule('hr') && <Item to="/hr" icon={ClipboardList} label="HR" onNavigate={onClose} />}

        {(canAccessModule('payments') || canAccessModule('pending')) && (
          <>
            <button
              onClick={() => setPaymentOpen((v) => !v)}
              className={`${linkBase} ${linkInactive} w-full justify-between`}
            >
              <span className="flex items-center gap-2.5">
                <WalletCards size={17} />
                Payment
              </span>
              <ChevronDown size={15} className={`transition-transform ${paymentOpen ? 'rotate-180' : ''}`} />
            </button>
            {paymentOpen && (
              <div className="space-y-1">
                {canAccessModule('payments') && <Item to="/payments" icon={WalletCards} label="All Payments" indent onNavigate={onClose} />}
                {canAccessModule('pending') && <Item to="/pending" icon={Hourglass} label="Pending" indent onNavigate={onClose} />}
              </div>
            )}
          </>
        )}
        {canAccessModule('accounting') && <Item to="/accounting" icon={Wallet} label="Accounting" onNavigate={onClose} />}
        {canAccessModule('approvals') && <Item to="/approvals" icon={ShieldCheck} label="Approvals" onNavigate={onClose} />}

        {(canAccessModule('activity_log') || canAccessModule('team') || canAccessModule('settings')) && (
          <>
            <button
              onClick={() => setAdminOpen((v) => !v)}
              className={`${linkBase} ${linkInactive} w-full justify-between`}
            >
              <span className="flex items-center gap-2.5">
                <UserCog size={17} />
                Admin
              </span>
              <ChevronDown size={15} className={`transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
            </button>
            {adminOpen && (
              <div className="space-y-1">
                {canAccessModule('activity_log') && <Item to="/activity-log" icon={History} label="Activity Log" indent onNavigate={onClose} />}
                {canAccessModule('team') && <Item to="/team" icon={UsersRound} label="Team" indent onNavigate={onClose} />}
                {canAccessModule('settings') && <Item to="/settings" icon={SettingsIcon} label="Settings" indent onNavigate={onClose} />}
              </div>
            )}
          </>
        )}
      </nav>

        <div className="px-3 py-3 bg-tan shrink-0">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-tan-ink hover:bg-white/40 w-full"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
