// Per-module access levels an Admin/CEO/MD can grant a user, on top of
// their base role (see user.entity.ts's UserRole). This is Phase 1 of
// granular permissions: it controls whether a module's menu item/page is
// reachable at all (frontend-enforced — see AuthContext.tsx on the
// frontend). It does NOT yet restrict individual actions inside a page
// (e.g. hiding just the "Delete" button while leaving "View"/"Edit"
// visible) — that's recorded here for a future phase but not enforced
// yet. Backend API routes still use the existing @Roles() guards
// unchanged, so this is additive, not a replacement for those checks.
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
