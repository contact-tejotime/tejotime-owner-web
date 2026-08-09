import { NextFunction, Request, Response } from 'express';
import { many, one } from '../db/pool';
import { Errors } from '../domain/errors';
import {
  Access,
  ModuleAccess,
  PermissionModule,
  atLeast,
  effectiveAccess,
  isAccess,
  isModule,
  isOwnerRole,
} from '../domain/permissions';
import { Principal } from '../http/types';

/**
 * Server-side enforcement of the per-module permissions an owner sets in the portal.
 *
 * This is the boundary. owner-web hides nav items it has no access to, but hiding a link has
 * never stopped anyone typing a URL or calling the API directly — until this guard existed, a
 * staff login would have seen the shop's whole customer book and revenue.
 *
 * Cost: one indexed lookup on `user_permission`, memoised on the request, and skipped entirely
 * for owners and co-owners (who cannot be overridden). So the common single-owner business
 * pays nothing.
 */

/** Effective access for the caller, computed once per request. */
export async function loadAccess(req: Request): Promise<ModuleAccess> {
  if (req.access) return req.access;
  const principal = req.principal;
  if (!principal) throw Errors.unauthenticated();

  let overrides: Partial<Record<PermissionModule, Access>> = {};
  if (!isOwnerRole(principal.role)) {
    const rows = await many<{ module: string; access: string }>(
      'select module, access from user_permission where user_id = $1',
      [principal.userId],
    );
    overrides = Object.fromEntries(
      rows
        .filter((r) => isModule(r.module) && isAccess(r.access))
        .map((r) => [r.module, r.access as Access]),
    );
  }

  req.access = effectiveAccess(principal.role, overrides);
  return req.access;
}

/** Gate a route on a module. `manage` for anything that writes, `view` for reads. */
export function requirePermission(mod: PermissionModule, need: Access = 'view') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    loadAccess(req)
      .then((access) => {
        if (!atLeast(access[mod], need)) {
          return next(Errors.forbidden('Your account does not have access to this'));
        }
        next();
      })
      .catch(next);
  };
}

/** Any one of several module/level pairs is enough. For routes that serve two screens. */
export function requireAnyPermission(pairs: [PermissionModule, Access][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    loadAccess(req)
      .then((access) => {
        if (!pairs.some(([mod, need]) => atLeast(access[mod], need))) {
          return next(Errors.forbidden('Your account does not have access to this'));
        }
        next();
      })
      .catch(next);
  };
}

/** Only the super owner. Used for the handful of actions co-owners must not reach. */
export function requireSuperOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) return next(Errors.unauthenticated());
  if (!req.principal.isSuperOwner) {
    return next(Errors.forbidden('Only the business owner can do this'));
  }
  next();
}

/**
 * For `/:id` routes: a staff login may only act on rows belonging to its own chair.
 *
 * Permissions decide which screens exist; this decides which rows inside them are yours.
 * Without it, a staff member with queue access could check out the customer sitting in
 * somebody else's chair simply by knowing the entry id.
 *
 * The table name is a literal from a closed union — it is never request data.
 */
export function requireOwnRow(table: 'queue_entry' | 'appointment') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) return next(Errors.unauthenticated());
    const seat = scopeStaffId(principal);
    if (!seat) return next();

    one<{ staff_id: string | null }>(
      `select staff_id from ${table} where id = $1 and business_id = $2`,
      [req.params.id, principal.businessId],
    )
      .then((row) => {
        if (!row) return next(Errors.notFound('Not found'));
        if (row.staff_id !== seat) {
          return next(Errors.forbidden('That belongs to another chair'));
        }
        next();
      })
      .catch(next);
  };
}

/**
 * The staff id a caller's reads must be narrowed to, or null for shop-wide access.
 *
 * Owners and co-owners see everything. A staff login sees only the chair it is linked to — and
 * a staff login with no chair linked yet sees nothing rather than everything, which is the
 * safe direction to fail.
 */
export function scopeStaffId(principal: Principal): string | null {
  if (isOwnerRole(principal.role) || principal.role === 'manager') return null;
  return principal.staffId ?? '00000000-0000-0000-0000-000000000000';
}
