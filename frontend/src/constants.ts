export const PAYMENT_TYPE_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card_machine', label: 'Card Payment' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'conditional', label: 'Conditional Payment' },
];

export const DELIVERY_METHOD_OPTIONS = [
  { value: 'on_site', label: 'Delivery on Site' },
  { value: 'in_store', label: 'In Store Delivery' },
];

export const TEMPLATE_OPTIONS = [
  { value: 'classic', label: 'Classic', desc: 'Round logo, centered watermark, minimal' },
  { value: 'formal', label: 'Formal', desc: 'Bordered boxes, bank details, 3 signatures' },
  { value: 'po_style', label: 'PO-style', desc: 'Letterhead header, Gross/Taxable/Net breakdown' },
];

export const USER_ROLE_OPTIONS = ['admin', 'ceo', 'md', 'accountant', 'production', 'sales'];

// One entry per left-menu area — must match the module keys the backend
// stores in User.modulePermissions (see erp-backend's
// src/auth/module-permissions.ts) and the routes in App.tsx/Sidebar.tsx.
export const MODULE_OPTIONS: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'sales_orders', label: 'Sales Orders' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'delivery_notes', label: 'Delivery Notes' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'recurring_invoices', label: 'Recurring Invoices' },
  { key: 'customers', label: 'Customers' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'hr', label: 'HR' },
  { key: 'payments', label: 'All Payments' },
  { key: 'pending', label: 'Pending' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'activity_log', label: 'Activity Log' },
  { key: 'team', label: 'Team' },
  { key: 'settings', label: 'Settings' },
];

// 'none' hides the module even for a role that would otherwise see it;
// any other level shows it even for a role that normally wouldn't — see
// AuthContext.tsx's canAccessModule() for how this combines with a
// user's base role. "view"/"edit"/"full" are recorded for a future phase
// (per-action button gating inside a page) but today only the
// none-vs-not-none distinction actually hides/shows the module.
export const ACCESS_LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'No Access' },
  { value: 'view', label: 'View Only' },
  { value: 'edit', label: 'View + Edit' },
  { value: 'full', label: 'View + Edit + Delete' },
];

// The role-based default for each module TODAY — i.e. exactly what
// Sidebar.tsx/App.tsx already gate on. A user's explicit
// modulePermissions entry (if any) overrides this per module; with no
// entry for a module, this default applies, so nothing changes for any
// existing account until an Admin/CEO/MD sets an explicit override.
// `null` means "any authenticated user" (no role restriction).
const ACCOUNTING_ROLES = ['admin', 'accountant', 'ceo', 'md'];
const TEAM_MANAGEMENT_ROLES = ['admin', 'ceo', 'md'];
const ADMIN_ONLY = ['admin'];
export const DEFAULT_MODULE_ROLES: Record<string, string[] | null> = {
  dashboard: null,
  inventory: null,
  sales_orders: null,
  quotations: null,
  delivery_notes: null,
  invoices: null,
  recurring_invoices: null,
  customers: null,
  suppliers: null,
  hr: null,
  payments: ACCOUNTING_ROLES,
  pending: ACCOUNTING_ROLES,
  accounting: ACCOUNTING_ROLES,
  approvals: ACCOUNTING_ROLES,
  activity_log: ACCOUNTING_ROLES,
  team: TEAM_MANAGEMENT_ROLES,
  settings: ADMIN_ONLY,
};

export function labelFor(options: { value: string; label: string }[], value?: string) {
  if (!value) return '-';
  return options.find((o) => o.value === value)?.label || value;
}
