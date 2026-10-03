import { SetMetadata, Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from './user.entity';
import { IS_PUBLIC_KEY } from './public.decorator';
import { MODULE_ACCESS_KEY, ModuleAccessMeta } from './module-access.decorator';
import {
  ALWAYS_FULL_ACCESS_ROLES,
  LEVEL_RANK,
  ModuleAccessLevel,
  ModuleKey,
  ModulePermissions,
  effectiveLevel,
  explicitLevel,
} from './module-permissions';

export const ROLES_KEY = 'roles';
// Usage: @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT) above a controller method.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

interface RequestUser {
  userId: string;
  role: string;
  modulePermissions?: ModulePermissions | null;
}

function levelForMethod(method: string): ModuleAccessLevel {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return ModuleAccessLevel.VIEW;
  if (m === 'DELETE') return ModuleAccessLevel.FULL;
  return ModuleAccessLevel.EDIT;
}

const MODULE_LABELS: Partial<Record<ModuleKey, string>> = {
  sales_orders: 'Sales Orders',
  delivery_notes: 'Delivery Notes',
  recurring_invoices: 'Recurring Invoices',
  activity_log: 'Activity Log',
  hr: 'HR',
};

function moduleLabel(module: ModuleKey): string {
  return MODULE_LABELS[module] || module.charAt(0).toUpperCase() + module.slice(1);
}

// One guard for both checks, run after JwtAuthGuard on every request:
//
// 1. Module permission (@ModuleAccess on the controller): the user's level
//    for the module must be at least what the call needs (GET -> view,
//    POST/PATCH/PUT -> edit, DELETE -> full). Admin/CEO/MD always pass.
// 2. Role list (@Roles): same as before. EXCEPT when an admin explicitly
//    gave this user a high-enough level for the module - that grant counts
//    as permission (so e.g. a Sales user given "Payments: View" can open
//    Payments), unless the route is marked strictRoles.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const access = this.reflector.getAllAndOverride<ModuleAccessMeta>(MODULE_ACCESS_KEY, targets);

    if (!user) return !requiredRoles || requiredRoles.length === 0;

    let grantedByAdmin = false;
    if (access && !ALWAYS_FULL_ACCESS_ROLES.includes(user.role)) {
      const needed = access.level || levelForMethod(request.method);
      const isRead = needed === ModuleAccessLevel.VIEW;
      const modules: ModuleKey[] = isRead ? [access.module, ...(access.readAlso || [])] : [access.module];

      const allowed = modules.some(
        (m) => LEVEL_RANK[effectiveLevel(user.role, user.modulePermissions, m)] >= LEVEL_RANK[needed],
      );
      if (!allowed) {
        const action = isRead ? 'open' : needed === ModuleAccessLevel.FULL ? 'delete items in' : 'make changes in';
        throw new ForbiddenException(`You don't have permission to ${action} ${moduleLabel(access.module)}.`);
      }

      // Only a grant for the route's OWN module may stand in for @Roles - a
      // readAlso module only opens the read-only list, never a role-limited
      // route.
      const explicit = explicitLevel(user.modulePermissions, access.module);
      grantedByAdmin = explicit !== null && LEVEL_RANK[explicit] >= LEVEL_RANK[needed];
    }

    // No @Roles() on the route -> any user who passed the module check.
    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (requiredRoles.includes(user.role as UserRole)) return true;
    return grantedByAdmin && !access?.strictRoles;
  }
}
