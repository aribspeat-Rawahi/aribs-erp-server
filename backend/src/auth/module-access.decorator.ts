import { SetMetadata } from '@nestjs/common';
import { ModuleAccessLevel, ModuleKey } from './module-permissions';

export const MODULE_ACCESS_KEY = 'moduleAccess';

export interface ModuleAccessOptions {
  // Level needed. Default comes from the HTTP method:
  // GET/HEAD -> view, POST/PATCH/PUT -> edit, DELETE -> full.
  level?: ModuleAccessLevel;
  // Read-only (GET) calls are ALSO allowed for users who can view any of
  // these modules. Used for lists that other pages need for their
  // dropdowns (e.g. the customer list on the Invoices page).
  readAlso?: ModuleKey[];
  // true = an explicit per-module level never replaces the route's
  // @Roles() list. Used where a grant could be abused to gain more access
  // (user management, database restore).
  strictRoles?: boolean;
}

export interface ModuleAccessMeta extends ModuleAccessOptions {
  module: ModuleKey;
}

// Usage: @ModuleAccess('invoices') on a controller class, and optionally on
// a single method to override it (method wins over class).
export const ModuleAccess = (module: ModuleKey, options: ModuleAccessOptions = {}) =>
  SetMetadata(MODULE_ACCESS_KEY, { module, ...options } as ModuleAccessMeta);

export const ANY_SIGNED_IN_USER_KEY = 'anySignedInUser';

// Marks a route that every signed-in user may call whatever their module
// permissions (e.g. GET /auth/me). Only documents the intent - the CI check
// (scripts/check-module-access.js) refuses routes with neither this,
// @Public() nor @ModuleAccess().
export const AnySignedInUser = () => SetMetadata(ANY_SIGNED_IN_USER_KEY, true);
