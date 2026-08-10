import "server-only";

import { unstable_cache, revalidateTag } from "next/cache";

import { BACKEND, REQUEST_TIMEOUT_MS } from "./http";
import type { Access, Module, ModuleAccess, UserRole } from "./roles";
import { getAccessToken, getBusinessId } from "./session";

/**
 * Server-only reads from the backend.
 *
 * Mirrors admin-panel/src/lib/server-api.ts, with one deliberate and load-bearing difference:
 *
 *   admin-panel keys its cache on the PATH ALONE and says so explicitly — the token is left out
 *   so every admin shares one entry. That is right for a platform-wide tool where all admins
 *   see identical data. It would be a CROSS-TENANT LEAK here: two businesses hitting
 *   `/dashboard/summary` must never share a cache entry. So every cached read below includes
 *   the business id (read from the access token's `bid` claim) in its key, and anything
 *   per-user bypasses the cache entirely via `getFresh`.
 *
 * The proxy (src/proxy.ts) guarantees the access cookie is fresh before any of this runs, so
 * there is no refresh logic here — Server Components cannot write cookies anyway.
 */

export const TAGS = {
  business: "business",
  services: "services",
  staff: "staff",
  queue: "queue",
  appointments: "appointments",
  customers: "customers",
  dashboard: "dashboard",
  notifications: "notifications",
  subscription: "subscription",
} as const;

/** Seconds. `queue` and `me` are absent on purpose — they are never cached. */
const TTL = {
  business: 300,
  services: 300,
  staff: 300,
  appointments: 60,
  customers: 60,
  dashboard: 30,
  notifications: 30,
  subscription: 300,
} as const;

/** `revalidateTag` needs Next 16's explicit profile argument. */
export function revalidateTags(...tags: string[]): void {
  for (const t of tags) revalidateTag(t, "max");
}

class Unauthorized extends Error {}

async function call<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Cached read. Returns null on failure so a page can degrade rather than crash; a 401 is
 * rethrown as `UNAUTHORIZED` so callers can redirect to /login.
 *
 * The token is read OUTSIDE `unstable_cache` and closed over — `cookies()` cannot be called
 * inside it, and including the token in the key would fragment the cache per session.
 */
export async function get<T>(path: string, tags: string[], revalidate: number): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const businessId = await getBusinessId();
  if (!businessId) return null;

  try {
    // businessId FIRST in the key — this is the tenant boundary.
    return await unstable_cache(() => call<T>(path, token), [businessId, path], {
      tags,
      revalidate,
    })();
  } catch (e) {
    if (e instanceof Unauthorized) throw new Error("UNAUTHORIZED");
    return null;
  }
}

/** Uncached read, for live data and anything scoped to one user. */
export async function getFresh<T>(path: string): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return await call<T>(path, token);
  } catch (e) {
    if (e instanceof Unauthorized) throw new Error("UNAUTHORIZED");
    return null;
  }
}

/* ------------------------------------------------------------------ DTOs */

export interface Me {
  user: {
    id: string;
    name: string | null;
    role: UserRole;
    darkMode: boolean;
    /** The one account per business that cannot be edited or removed from the portal. */
    isSuperOwner: boolean;
    /** The chair a staff login works. Null for owners. */
    staffId: string | null;
    /**
     * Role defaults with this business's overrides already applied — resolved by the same
     * function the API guards use, so the nav can never show a screen the server would refuse.
     */
    permissions: ModuleAccess;
  };
  business: {
    id: string;
    name: string;
    slug: string;
    plan: "free" | "premium";
    /** Store Appearance — present once the API ships theme on /auth/me. */
    theme?: ThemeConfig | null;
    themeColor?: string | null;
  };
}

/** A team login as the /settings/team screen sees it. Mirrors the backend's UserDTO. */
export interface TeamUser {
  id: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  isSuperOwner: boolean;
  isActive: boolean;
  staffId: string | null;
  staffName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  permissions: ModuleAccess;
  overrides: Partial<ModuleAccess>;
}

export interface Money {
  amount: number;
  currency: string;
}

/**
 * These two mirror the backend's `cardToDTO` / `seatToDTO` (backend/src/modules/queue/
 * queue.service.ts) FIELD FOR FIELD. They previously did not, and nothing caught it: `call<T>`
 * casts the parsed JSON straight to T, so a hand-written interface that disagrees with the API
 * type-checks perfectly and then renders `undefined` at runtime.
 *
 * That is exactly what happened — `customerName`, `token`, `serviceName` and `isWaiting` did
 * not exist on the response, so the queue showed a bare "·" for every customer and, because
 * `isWaiting` was always undefined, offered "Check out" to people who had not started yet.
 *
 * If the backend DTO changes, change these too. There is no compiler between them.
 */
export interface QueueCard {
  id: string;
  name: string;
  service: string | null;
  status: "waiting" | "in_service" | "completed" | "no_show" | "cancelled";
  position: number;
  source: "walk_in" | "online";
  /** Pre-rendered by the queue engine, e.g. "Next up" or "~15 min". */
  rightText: string;
  etaMinutes: number;
  initials: string;
  seatId: string | null;
  seatName: string | null;
  seatColor: string;
  online: boolean;
  visitorType: "mr" | "patient" | null;
}

export interface SeatGroup {
  id: string;
  name: string;
  colorToken: string;
  serving: boolean;
  servingName: string;
  /** Pre-rendered status line, e.g. "Available · ready for walk-in". */
  subLine: string;
  waitBadge: string;
  waitingCount: number;
  clearMinutes: number;
  free: boolean;
  empty: boolean;
  cards: QueueCard[];
}

export interface QueueView {
  seats: SeatGroup[];
  summary: { seatCount: number; activeCount: number; waitingCount: number };
}

export interface ServiceRow {
  id: string;
  name: string;
  durationMinutes: number;
  price: Money;
  isActive: boolean;
  position: number;
}

export interface StaffRow {
  id: string;
  name: string;
  roleLabel: string | null;
  avatarUrl: string | null;
  acceptsWalkIns: boolean;
  isActive: boolean;
  position: number;
  userId: string | null;
}

export interface AppointmentRow {
  id: string;
  customerName: string;
  customerPhone: string | null;
  serviceName: string | null;
  staffId: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  status: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number;
  totalSpend: Money;
  lastVisitAt: string | null;
}

export interface DashboardSummary {
  range: "today" | "month";
  periodLabel: string;
  date: string;
  kpis: {
    todaysAppointments: number;
    activeNow: number;
    waitingNow: number;
    checkInCount: number;
    completed: number;
    revenue: Money;
  };
}

export interface DashboardStaffRow {
  staffId: string;
  name: string;
  appointments: number;
  completed: number;
  revenue: Money;
}

export interface DashboardByStaff {
  range: "today" | "month";
  periodLabel: string;
  data: DashboardStaffRow[];
}

/** Mirrors `business.theme` — the microsite appearance config. Every field optional. */
export interface ThemeConfig {
  preset?: "minimal" | "luxury" | "modern" | "bold" | "medical" | "warm";
  mode?: "light" | "dark" | "auto";
  brand?: string;
  radius?: "sharp" | "medium" | "rounded";
  shadow?: "none" | "soft" | "premium";
  density?: "comfortable" | "compact";
  animation?: "subtle" | "normal" | "rich";
  heroVariant?: "split-classic" | "editorial" | "split-modern" | "full-bleed" | "trust" | "cozy";
  accent?: string;
  brandInk?: "auto" | "white" | "dark";
}

export interface BusinessDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  category: string | null;
  area: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  tagline: string | null;
  heroSubtitle: string | null;
  statValue: string | null;
  statLabel: string | null;
  description: string | null;
  aboutHeading: string | null;
  logoUrl: string | null;
  heroImageUrl: string | null;
  aboutImageUrl: string | null;
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
  payments: string[];
  theme: ThemeConfig | null;
  themeColor: string | null;
  establishedYear: number | null;
  timezone: string;
  currency: string;
  plan: string;
  hours: { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean }[];
  amenities: string[];
  faqs: { q: string; a: string }[];
  reviews: { stars: number; text: string; authorName: string }[];
  gallery: { id: string; url: string; alt: string | null }[];
}

/* --------------------------------------------------------------- readers */

/**
 * The signed-in user. NEVER cached — it is per-user, and a shared entry would hand one
 * business's identity to another.
 */
export const getMe = () => getFresh<Me>("/auth/me");

/** Live data mutated by customers on the microsite with no revalidate hook back here. */
export const getQueue = () => getFresh<QueueView>("/queue?view=grouped");

export const getServices = () =>
  get<{ data: ServiceRow[] }>("/services", [TAGS.services], TTL.services);

export const getStaff = () => get<{ data: StaffRow[] }>("/staff", [TAGS.staff], TTL.staff);

export const getBusiness = () =>
  get<BusinessDetail>("/business", [TAGS.business], TTL.business);

export const getBusinessQr = () =>
  get<{ slug: string; phoneFull: string; bookingUrl: string | null; cardUrl: string | null }>(
    "/business/qr",
    [TAGS.business],
    TTL.business,
  );

/** Seat-scoped for staff — never share a business-wide cache entry. */
export const getDashboard = (range: "today" | "month" = "today") =>
  getFresh<DashboardSummary>(`/dashboard/summary?range=${range}`);

/** Store-wide roles only; staff get 403 from the API. */
export const getDashboardByStaff = (range: "today" | "month" = "today") =>
  getFresh<DashboardByStaff>(`/dashboard/by-staff?range=${range}`);

export const getAppointments = (query = "") =>
  get<{ data: AppointmentRow[] }>(
    `/appointments${query}`,
    [TAGS.appointments],
    TTL.appointments,
  );

export const getCustomers = async (search = "") => {
  // Backend returns `{ data, meta: { shown, total, lockedCount } }` — flatten for pages.
  const res = await get<{
    data: CustomerRow[];
    meta?: { shown?: number; total?: number; lockedCount?: number };
    shown?: number;
    total?: number;
    lockedCount?: number;
  }>(
    `/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    [TAGS.customers],
    TTL.customers,
  );
  if (!res) return null;
  const data = res.data ?? [];
  return {
    data,
    shown: res.meta?.shown ?? res.shown ?? data.length,
    total: res.meta?.total ?? res.total ?? data.length,
    lockedCount: res.meta?.lockedCount ?? res.lockedCount ?? 0,
  };
};

export const getCustomer = (id: string) =>
  get<CustomerRow>(`/customers/${id}`, [TAGS.customers], TTL.customers);

export const getCustomerVisits = (id: string) =>
  get<{ data: { id: string; serviceName: string | null; amount: Money; completedAt: string }[] }>(
    `/customers/${id}/visits`,
    [TAGS.customers],
    TTL.customers,
  );

export const getNotifications = () =>
  get<{ data: { id: string; title: string; body: string | null; readAt: string | null }[] }>(
    "/notifications",
    [TAGS.notifications],
    TTL.notifications,
  );

/**
 * Team logins. Uncached: it is a small list read only by the owner who is editing it, and a
 * stale one would show a login the owner just removed as though it were still live.
 */
export const getTeam = () => getFresh<{ data: TeamUser[] }>("/users");

/**
 * The permission catalogue the editor renders from — grantable modules and the defaults each
 * role starts at. Fetched rather than hardcoded so "unchanged from the default" means exactly
 * the same thing here as it does in the guard that enforces it.
 */
export const getPermissionCatalogue = () =>
  get<{
    modules: { key: Module; label: string }[];
    accessLevels: Access[];
    /** Grantable modules only — `team` is owner-role-only and never appears here. */
    defaults: { staff: Partial<ModuleAccess>; co_owner: Partial<ModuleAccess> };
  }>("/users/modules", [TAGS.staff], TTL.staff);

export const getSubscription = () =>
  get<{ plan: string; status: string; trialEndsAt: string | null }>(
    "/subscription",
    [TAGS.subscription],
    TTL.subscription,
  );
