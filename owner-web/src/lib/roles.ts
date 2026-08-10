/**
 * Role and permission model for the business portal.
 *
 * The matrix that used to live here is gone. `/auth/me` now returns the RESOLVED permission
 * map — role defaults with the owner's per-module overrides already applied, computed by the
 * same `effectiveAccess` the backend's route guards call. So this file no longer decides
 * anything; it reads what the server decided and turns it into navigation.
 *
 * That is deliberate. Two copies of "what can a staff member see" would drift the first time
 * someone changed one of them, and the copy that drifts is always the one users notice.
 *
 * IMPORTANT: still presentation only. Hiding a nav item is tidy UI, not access control — the
 * backend refuses the request either way (middleware/require-permission.ts).
 */

export type UserRole = "owner" | "co_owner" | "manager" | "staff";

export type Module =
  | "dashboard"
  | "queue"
  | "appointments"
  | "calendar"
  | "customers"
  | "services"
  | "staff"
  | "hours"
  | "notifications"
  | "billing"
  | "profile"
  | "team";

export type Access = "none" | "view" | "manage";

export type ModuleAccess = Record<Module, Access>;

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  co_owner: "Co-owner",
  manager: "Manager",
  staff: "Staff",
};

/** What the team screen offers when creating a login. The super owner is not creatable. */
export const CREATABLE_ROLES: { value: "co_owner" | "staff"; label: string; blurb: string }[] = [
  {
    value: "co_owner",
    label: "Co-owner",
    blurb: "Same access as you. Can add and manage staff. Cannot change your owner account.",
  },
  {
    value: "staff",
    label: "Staff",
    blurb: "Sees only what you allow, and only their own chair's queue and appointments.",
  },
];

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  queue: "Queue",
  appointments: "Appointments",
  calendar: "Calendar",
  customers: "Customers",
  services: "Services",
  staff: "Staff & seats",
  hours: "Opening hours",
  notifications: "Notifications",
  billing: "Subscription & billing",
  profile: "Business profile",
  team: "Team logins",
};

/** Mirrors backend GRANTABLE_MODULES — `team` is owner-only and never a checkbox. */
export const GRANTABLE_MODULES: Module[] = [
  "dashboard",
  "queue",
  "appointments",
  "calendar",
  "customers",
  "services",
  "staff",
  "hours",
  "notifications",
  "billing",
  "profile",
];

export const ACCESS_LABELS: Record<Access, string> = {
  none: "Hidden",
  view: "View only",
  manage: "Full access",
};

const RANK: Record<Access, number> = { none: 0, view: 1, manage: 2 };

export function can(access: ModuleAccess, module: Module, need: Access = "view"): boolean {
  return RANK[access?.[module] ?? "none"] >= RANK[need];
}

export function isOwnerRole(role: UserRole): boolean {
  return role === "owner" || role === "co_owner";
}

/**
 * A safe fallback for the moment before `/auth/me` has answered, and for any pre-permissions
 * token still in flight. Everything hidden — the direction that fails closed.
 */
export const NO_ACCESS: ModuleAccess = {
  dashboard: "none",
  queue: "none",
  appointments: "none",
  calendar: "none",
  customers: "none",
  services: "none",
  staff: "none",
  hours: "none",
  notifications: "none",
  billing: "none",
  profile: "none",
  team: "none",
};

/** Which module owns a given path. Longest prefix wins, so /settings/staff beats /settings. */
const PATH_MODULES: [string, Module][] = [
  ["/settings/profile", "profile"],
  ["/settings/services", "services"],
  ["/settings/staff", "staff"],
  ["/settings/team", "team"],
  ["/settings/hours", "hours"],
  ["/settings/notifications", "notifications"],
  ["/settings/subscription", "billing"],
  ["/dashboard", "dashboard"],
  ["/stats", "dashboard"],
  ["/queue", "queue"],
  ["/appointments", "appointments"],
  ["/calendar", "calendar"],
  ["/customers", "customers"],
];

export function moduleForPath(path: string): Module | null {
  // /settings itself is the tile index — always reachable; the tiles filter themselves.
  if (path === "/settings") return null;
  const hit = PATH_MODULES.filter(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}

export function canAccessPath(access: ModuleAccess, path: string): boolean {
  // Home embeds the live queue — queue-only staff must still reach /dashboard.
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return can(access, "dashboard") || can(access, "queue");
  }
  // Named `mod`, not `module` — Next forbids assigning to that identifier.
  const mod = moduleForPath(path);
  if (!mod) return true;
  return can(access, mod);
}

/** Where to send someone after sign-in: the first screen they are actually allowed to open. */
export function landingPath(access: ModuleAccess): string {
  if (can(access, "dashboard") || can(access, "queue")) return "/dashboard";
  const order: [Module, string][] = [
    ["appointments", "/appointments"],
    ["calendar", "/calendar"],
    ["customers", "/customers"],
  ];
  const hit = order.find(([mod]) => can(access, mod));
  return hit ? hit[1] : "/settings";
}

export const NAV_ITEMS: {
  href: string;
  label: string;
  icon: "layoutDashboard" | "star" | "calendar" | "grid" | "user" | "settings";
  /** Primary module for the item; Home also allows queue-only via navItemsFor. */
  module: Module | null;
}[] = [
  { href: "/dashboard", label: "Home", icon: "layoutDashboard", module: "dashboard" },
  { href: "/stats", label: "Reports", icon: "star", module: "dashboard" },
  { href: "/appointments", label: "Appointments", icon: "calendar", module: "appointments" },
  { href: "/calendar", label: "Calendar", icon: "grid", module: "calendar" },
  { href: "/customers", label: "Customers", icon: "user", module: "customers" },
  { href: "/settings", label: "Settings", icon: "settings", module: null },
];

export function navItemsFor(access: ModuleAccess) {
  return NAV_ITEMS.filter((item) => {
    if (item.module === null) return true;
    if (item.href === "/dashboard") return can(access, "dashboard") || can(access, "queue");
    if (item.href === "/stats") return can(access, "dashboard");
    return can(access, item.module);
  });
}

export function settingsTilesFor(access: ModuleAccess, role: UserRole) {
  const all: { href: string; title: string; desc: string; module: Module }[] = [
    { href: "/settings/profile", title: "Profile", desc: "Your name and password", module: "profile" },
    { href: "/settings/team", title: "Team logins", desc: "Co-owners, staff and what they can see", module: "team" },
    { href: "/settings/staff", title: "Staff", desc: "Seats and team members", module: "staff" },
    { href: "/settings/services", title: "Services", desc: "Services and durations", module: "services" },
    { href: "/settings/hours", title: "Hours", desc: "Weekly opening hours", module: "hours" },
    { href: "/settings/notifications", title: "Notifications", desc: "Alerts and reminders", module: "notifications" },
    { href: "/settings/subscription", title: "Subscription", desc: "Plan and billing", module: "billing" },
  ];
  return all.filter((t) => {
    // Team management is tied to the role, not to a permission — matching the backend, where
    // "can create logins" is the one thing an owner cannot delegate.
    if (t.module === "team") return isOwnerRole(role);
    // Everyone can reach their own profile page to change their password, even when the
    // business-profile module is closed to them.
    if (t.module === "profile") return true;
    return can(access, t.module);
  });
}
