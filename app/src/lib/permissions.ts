/**
 * Role and permission model for the owner app.
 *
 * MIRROR of `owner-web/src/lib/roles.ts`. The two are deliberately duplicated rather than
 * shared: every deployable in this monorepo Docker-builds from its own folder with `COPY . .`,
 * so a repo-root package would not be present at build time. Same reasoning as the theme
 * engine mirror. Keep them in step by hand.
 *
 * Neither copy DECIDES anything. `/auth/me` returns the resolved permission map — role defaults
 * with the owner's overrides already applied, computed by the same `effectiveAccess` the API's
 * route guards call — and both clients only read it. That is what stops the app and the web
 * portal from disagreeing about what a staff member can see.
 *
 * These checks are UI affordances, not security. The backend refuses the request either way
 * (backend/src/middleware/require-permission.ts).
 */

export type UserRole = 'owner' | 'co_owner' | 'manager' | 'staff';

export type PermissionModule =
  | 'dashboard'
  | 'queue'
  | 'appointments'
  | 'calendar'
  | 'customers'
  | 'services'
  | 'staff'
  | 'hours'
  | 'notifications'
  | 'billing'
  | 'profile'
  | 'team';

export type Access = 'none' | 'view' | 'manage';

export type ModuleAccess = Record<PermissionModule, Access>;

/** Mirrors backend GRANTABLE_MODULES — `team` is owner-role-only and never a checkbox. */
export const GRANTABLE_MODULES: PermissionModule[] = [
  'dashboard',
  'queue',
  'appointments',
  'calendar',
  'customers',
  'services',
  'staff',
  'hours',
  'notifications',
  'billing',
  'profile',
];

const RANK: Record<Access, number> = { none: 0, view: 1, manage: 2 };

export function can(access: ModuleAccess | null, mod: PermissionModule, need: Access = 'view'): boolean {
  if (!access) return false;
  return RANK[access[mod] ?? 'none'] >= RANK[need];
}

export function isOwnerRole(role: UserRole | null): boolean {
  return role === 'owner' || role === 'co_owner';
}

/**
 * Fail-closed default: used before `/auth/me` answers, and for any pre-permissions token still
 * in flight after an upgrade. Everything hidden is the recoverable direction to be wrong in.
 */
export const NO_ACCESS: ModuleAccess = {
  dashboard: 'none',
  queue: 'none',
  appointments: 'none',
  calendar: 'none',
  customers: 'none',
  services: 'none',
  staff: 'none',
  hours: 'none',
  notifications: 'none',
  billing: 'none',
  profile: 'none',
  team: 'none',
};

/** The permission map the API accepts: every grantable module, nothing else. */
export function toPermissionPayload(
  draft: Partial<Record<PermissionModule, Access>>,
): Record<string, Access> {
  const out: Record<string, Access> = {};
  for (const m of GRANTABLE_MODULES) out[m] = draft[m] ?? 'none';
  return out;
}

export interface SessionUser {
  id: string;
  name: string | null;
  role: UserRole;
  isSuperOwner: boolean;
  /** The chair a staff login works. Null for owners. Drives own-data-only scoping. */
  staffId: string | null;
  permissions: ModuleAccess;
}

/** Normalise `/auth/me` and `/auth/login` into a session, tolerating a pre-permissions API. */
export function toSessionUser(raw: any): SessionUser | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    name: raw.name ?? null,
    role: (raw.role as UserRole) ?? 'staff',
    isSuperOwner: raw.isSuperOwner === true,
    staffId: raw.staffId ?? null,
    permissions: (raw.permissions as ModuleAccess) ?? NO_ACCESS,
  };
}
