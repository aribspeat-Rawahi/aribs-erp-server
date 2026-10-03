// Per-module access levels an Admin/CEO/MD can grant a user, on top of
// their base role (see user.entity.ts's UserRole).
//
// Enforced in two places that MUST agree:
// - frontend (AuthContext.tsx canAccessModule) decides which menu items and
//   pages a user sees;
// - backend (roles.guard.ts + @ModuleAccess on every controller) decides
//   which API calls a user may make: GET needs "view", POST/PATCH/PUT need
//   "edit", DELETE needs "full".
export enum ModuleAccessLevel {
  NONE = 'none',
  VIEW = 'view',
  EDIT = 'edit',
  FULL = 'full',
}

// One key per left-menu area (matches erp-frontend-src's Sidebar.tsx /
// App.tsx routes one-to-one). Keep this list and the frontend's
// MODULE_OPTIONS (src/constants.ts) in sync when a new top-level area is
// added.
export const MODULE_KEYS = [
  'dashboard',
  'inventory',
  'sales_orders',
  'quotations',
  'delivery_notes',
  'invoices',
  'recurring_invoices',
  'customers',
  'suppliers',
  'hr',
  'payments',
  'pending',
  'accounting',
  'approvals',
  'activity_log',
  'team',
  'settings',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModulePermissions = Partial<Record<ModuleKey, ModuleAccessLevel>>;

// Rank of each level, so "at least view" etc. can be compared.
export const LEVEL_RANK: Record<ModuleAccessLevel, number> = {
  [ModuleAccessLevel.NONE]: 0,
  [ModuleAccessLevel.VIEW]: 1,
  [ModuleAccessLevel.EDIT]: 2,
  [ModuleAccessLevel.FULL]: 3,
};

// Roles that always have full access to every module, whatever their
// per-module settings say (same rule as the frontend).
export const ALWAYS_FULL_ACCESS_ROLES = ['admin', 'ceo', 'md'];

const ACCOUNTING_ROLES = ['admin', 'accountant', 'ceo', 'md'];

// Who can use a module when an admin has NOT set a level for that user.
// null = every role. MUST match DEFAULT_MODULE_ROLES in the frontend's
// src/constants.ts.
export const DEFAULT_MODULE_ROLES: Record<ModuleKey, string[] | null> = {
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
  team: ['admin', 'ceo', 'md'],
  settings: ['admin'],
};

function isLevel(value: unknown): value is ModuleAccessLevel {
  return typeof value === 'string' && value in LEVEL_RANK;
}

// The level an admin explicitly set for this user and module, if any.
export function explicitLevel(
  permissions: ModulePermissions | null | undefined,
  module: ModuleKey,
): ModuleAccessLevel | null {
  const value = permissions?.[module];
  return isLevel(value) ? value : null;
}

// The level a user actually has for a module:
// admin/CEO/MD -> full; an explicit setting wins; otherwise the role
// default (full if the role may use the module, none if not). Role-default
// users are still limited by the route's own @Roles() list, exactly as
// before per-module permissions existed.
export function effectiveLevel(
  role: string,
  permissions: ModulePermissions | null | undefined,
  module: ModuleKey,
): ModuleAccessLevel {
  if (ALWAYS_FULL_ACCESS_ROLES.includes(role)) return ModuleAccessLevel.FULL;
  const explicit = explicitLevel(permissions, module);
  if (explicit) return explicit;
  const defaults = DEFAULT_MODULE_ROLES[module];
  return defaults === null || defaults.includes(role) ? ModuleAccessLevel.FULL : ModuleAccessLevel.NONE;
}
