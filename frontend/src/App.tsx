import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import SalesOrders from './pages/SalesOrders';
import Quotations from './pages/Quotations';
import DeliveryNotes from './pages/DeliveryNotes';
import Invoices from './pages/Invoices';
import RecurringInvoices from './pages/RecurringInvoices';
import Suppliers from './pages/Suppliers';
import HR from './pages/HR';
import Payments from './pages/Payments';
import Pending from './pages/Pending';
import Accounting from './pages/Accounting';
import ReportDetail from './pages/ReportDetail';
import ActivityLog from './pages/ActivityLog';
import Approvals from './pages/Approvals';
import Team from './pages/Team';
import Settings from './pages/Settings';

// `module` (a MODULE_OPTIONS key from constants.ts) is checked through
// the SAME canAccessModule() as Sidebar.tsx, so a route is reachable
// exactly when its sidebar link is visible — one source of truth instead
// of two hand-kept-in-sync role lists. Omit `module` for a route every
// authenticated user can always reach (e.g. Dashboard/HR today).
function ProtectedRoute({ children, module }: { children: JSX.Element; module?: string }) {
  const { user, loading, canAccessModule } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (module && !canAccessModule(module)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/" element={<ProtectedRoute module="dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
      {/* Manufacturing and Traceability were merged into Inventory — keep old
          links/bookmarks working by redirecting instead of a dead route. */}
      <Route path="/manufacturing" element={<Navigate to="/inventory" replace />} />
      <Route path="/traceability" element={<Navigate to="/inventory" replace />} />
      <Route path="/customers" element={<ProtectedRoute module="customers"><Customers /></ProtectedRoute>} />
      <Route path="/sales-orders" element={<ProtectedRoute module="sales_orders"><SalesOrders /></ProtectedRoute>} />
      <Route path="/quotations" element={<ProtectedRoute module="quotations"><Quotations /></ProtectedRoute>} />
      <Route path="/delivery-notes" element={<ProtectedRoute module="delivery_notes"><DeliveryNotes /></ProtectedRoute>} />
      <Route path="/invoices" element={<ProtectedRoute module="invoices"><Invoices /></ProtectedRoute>} />
      <Route path="/recurring-invoices" element={<ProtectedRoute module="recurring_invoices"><RecurringInvoices /></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute module="suppliers"><Suppliers /></ProtectedRoute>} />
      <Route path="/hr" element={<ProtectedRoute module="hr"><HR /></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute module="payments"><Payments /></ProtectedRoute>} />
      <Route path="/pending" element={<ProtectedRoute module="pending"><Pending /></ProtectedRoute>} />
      <Route path="/accounting" element={<ProtectedRoute module="accounting"><Accounting /></ProtectedRoute>} />
      {/* Reports Hub — each card on Accounting's Reports tab opens its own
          full-page report here. */}
      <Route path="/accounting/reports/:reportKey" element={<ProtectedRoute module="accounting"><ReportDetail /></ProtectedRoute>} />
      {/* Reports and Cash & Bank both moved inside Accounting (its "Reports"
          and "Accounts" tabs) — keep old links/bookmarks working by
          redirecting instead of a dead route. */}
      <Route path="/reports" element={<Navigate to="/accounting" replace />} />
      <Route path="/cash-bank" element={<Navigate to="/accounting" replace />} />
      <Route path="/activity-log" element={<ProtectedRoute module="activity_log"><ActivityLog /></ProtectedRoute>} />
      <Route path="/approvals" element={<ProtectedRoute module="approvals"><Approvals /></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute module="team"><Team /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
