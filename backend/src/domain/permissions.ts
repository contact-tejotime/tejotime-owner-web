/**
 * Per-module permissions for business logins.
 *
 * The catalogue lives here, in code, not in the database — adding a screen is a deploy, not a
 * migration. `user_permission` (0019) only stores the deliberate *overrides* an owner has set;
 * everything else falls back to ROLE_DEFAULTS below.
 *
 * This module is imported by both the route guards and `/auth/me`, so what the UI hides and
 * what the API refuses are computed from one source. The API is still the boundary — the UI
 * only decides what to draw.
 */
import { UserRole } from './enums';

/** Every screen an owner can grant or withhold. Order is the order shown in the portal. */
export const MODULES = [
  'dashboard',
  'commission',
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
  'team',
] as const;
export type PermissionModule = (typeof MODULES)[number];

/**
 * What an owner may hand out. `team` is missing on purpose — "can create logins" is the one
 * permission that would let a staff account grant itself all the others, so it stays tied to
 * the owner roles instead of being a checkbox.
 */
export const GRANTABLE_MODULES = [
  'dashboard',
  'commission',
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
] as const satisfies readonly PermissionModule[];
export type GrantableModule = (typeof GRANTABLE_MODULES)[number];

export const ACCESS_LEVELS = ['none', 'view', 'manage'] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

export type ModuleAccess = Record<PermissionModule, Access>;

export type GrantableAccess = Record<GrantableModule, Access>;

/**
 * A role's defaults reduced to what an owner may actually set.
 *
 * The full map always carries `team`, which is owner-role-only and therefore not a valid key
 * in the permission payloads. Handing the editor an unfiltered map made it seed a draft
 * containing `team` and then get that draft rejected on save.
 */
export function grantableSubset(access: ModuleAccess): GrantableAccess {
  return Object.fromEntries(GRANTABLE_MODULES.map((m) => [m, access[m]])) as GrantableAccess;
}

/** Human labels, reused by the portal's permission editor. */
export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: 'Dashboard',
  commission: 'Commission & earnings',
  queue: 'Queue',
  appointments: 'Appointments',
  calendar: 'Calendar',
  customers: 'Customers',
  services: 'Services',
  staff: 'Staff & seats',
  hours: 'Opening hours',
  notifications: 'Notifications',
  billing: 'Subscription & billing',
  profile: 'Business profile',
  team: 'Team logins',
};

const RANK: Record<Access, number> = { none: 0, view: 1, manage: 2 };

export function atLeast(have: Access, need: Access): boolean {
  return RANK[have] >= RANK[need];
}

/**
 * The most a role that is NOT an owner may ever hold, per module.
 *
 * `commission: 'manage'` is setting pay rates. A staff login must never be able to set its own
 * rate, or a colleague's — the reasoning that keeps `team` off GRANTABLE_MODULES — but unlike
 * `team` there is a legitimate lower level: an owner may let a stylist SEE their own earnings.
 * So the module is grantable and capped. The permission editor refuses anything above the cap
 * (users.routes), and effectiveAccess clamps to it, so a stale or hand-written user_permission
 * row can never get past a guard.
 */
export const GRANT_CEILING: Partial<Record<PermissionModule, Access>> = { commission: 'view' };

/** The levels the permission editor may offer for a module: `none` up to its ceiling. */
export function grantLevels(mod: PermissionModule): Access[] {
  const max = GRANT_CEILING[mod] ?? 'manage';
  return ACCESS_LEVELS.filter((level) => atLeast(max, level));
}

function everyModule(access: Access): ModuleAccess {
  return Object.fromEntries(MODULES.map((m) => [m, access])) as ModuleAccess;
}

/**
 * What each role gets before overrides.
 *
 * `staff` is deliberately narrow. It gets its own chair's queue and nothing that would expose
 * the shop's customer list or money — an owner has to grant those one at a time. Even when
 * granted, the read itself is scoped to that staff member (see scopeStaffId).
 */
export const ROLE_DEFAULTS: Record<UserRole, ModuleAccess> = {
  owner: everyModule('manage'),
  co_owner: everyModule('manage'),
  // Legacy role, kept so pre-0019 rows behave sensibly. Runs the shop, does not hold the account.
  // Sees the commission report but cannot set rates (GRANT_CEILING applies to it too).
  manager: { ...everyModule('manage'), billing: 'view', team: 'view', commission: 'view' },
  staff: {
    dashboard: 'view',
    // Hidden until the owner chooses to show a stylist their own earnings.
    commission: 'none',
    queue: 'manage',
    appointments: 'view',
    calendar: 'view',
    customers: 'none',
    services: 'none',
    staff: 'none',
    hours: 'none',
    notifications: 'view',
    billing: 'none',
    profile: 'none',
    team: 'none',
  },
};

/**
 * Roles whose access is not negotiable. An override row against an owner is ignored rather
 * than rejected, so a stale row can never quietly lock the account holder out of their own
 * business.
 */
export const FIXED_ROLES: readonly UserRole[] = ['owner', 'co_owner'];

export function isOwnerRole(role: UserRole): boolean {
  return FIXED_ROLES.includes(role);
}

export function isModule(value: string): value is PermissionModule {
  return (MODULES as readonly string[]).includes(value);
}

export function isAccess(value: string): value is Access {
  return (ACCESS_LEVELS as readonly string[]).includes(value);
}

/**
 * Role defaults, then the owner's overrides on top, then the grant ceiling. Owners ignore
 * overrides (and the ceiling) entirely.
 */
export function effectiveAccess(
  role: UserRole,
  overrides: Partial<Record<PermissionModule, Access>> = {},
): ModuleAccess {
  const base = { ...(ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.staff) };
  if (isOwnerRole(role)) return base;
  for (const [mod, access] of Object.entries(overrides)) {
    if (isModule(mod) && access && isAccess(access)) base[mod] = access;
  }
  for (const [mod, max] of Object.entries(GRANT_CEILING) as [PermissionModule, Access][]) {
    if (!atLeast(max, base[mod])) base[mod] = max;
  }
  return base;
}
