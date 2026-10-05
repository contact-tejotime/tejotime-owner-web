import "server-only";

import { unstable_cache, revalidateTag } from "next/cache";

import { BACKEND, REQUEST_TIMEOUT_MS } from "./http";
import { reportQueryString, type ReportQuery, type ReportRange } from "./commission";
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

/**
 * `revalidateTag` needs Next 16's explicit profile argument — and it MUST be `{ expire: 0 }`,
 * not the string `"max"`. `"max"` looks like "revalidate fully", but it's the name of Next's
 * built-in LONGEST cache-life profile (`stale: 5min, revalidate: 30d, expire: 365d` — see
 * `next/dist/server/config-shared.js`). Next's own `revalidate()` only flags the current
 * request for "read your own write" when the resolved profile's `expire` is exactly `0`
 * (`next/dist/server/web/spec-extension/revalidate.js`); a string profile that doesn't resolve
 * to `expire: 0` still queues the tag for eventual revalidation, but the very next
 * `router.refresh()` after a mutation is not guaranteed to see it — which is exactly the bug
 * this used to have (a save would need a manual page reload to show up). An object profile is
 * used as-is, no `next.config` / cacheComponents changes needed.
 */
export function revalidateTags(...tags: string[]): void {
  for (const t of tags) revalidateTag(t, { expire: 0 });
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
    /** Free-text category — gates checkout add-on chips. */
    category?: string | null;
    /**
     * ISO 4217 code the store prices in (set in the admin panel). Carried on the session so every
     * role — staff cannot read GET /business — can show the right symbol on a price input.
     */
    currency?: string | null;
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

/**
 * How a service is priced. `unset` is legacy — services that predate pricing modes and were
 * carrying a zero to mean "not priced yet". The API refuses it on write, so an owner who opens
 * one has to choose a real mode. See backend/db/migrations/0024_service_price_range.sql.
 */
export type ServicePriceType = "fixed" | "range" | "unset";

export interface ServiceRow {
  id: string;
  name: string;
  durationMinutes: number;
  /** The fixed price, or the MINIMUM of a range — `priceType` says which. */
  price: Money;
  priceType: ServicePriceType;
  /** The maximum of a range. Null for every other mode. */
  priceMax: Money | null;
  /** The service's colour ('primary' | 'secondary' | 'amber500' | 'green500') — the accent bar on
   *  the Services list, as in the app. The API always sent it; optional so a cached response from
   *  before this mirror carried it still type-checks honestly. */
  colorToken?: string;
  isActive: boolean;
  position: number;
}

export interface StaffRow {
  id: string;
  name: string;
  /** The chair's colour ('primary' | 'secondary' | 'amber500' | 'green500'). The API always sent
   *  it; this mirror had dropped it, so the walk-in seat picker had no colour to draw. */
  colorToken: string;
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
  /** Hospital stores only: who the visitor is. The API always sent it; the calendar now shows it
   *  as the app's MR / Patient badge. Optional so an older cached payload still type-checks. */
  visitorType?: "mr" | "patient" | null;
  /**
   * Recurring appointments (migration 0036, backend `apptDTO`). `seriesId` is null on a one-off
   * booking and draws the repeat icon; `occurrenceDate` is the rule date the visit was booked for
   * (store-local "YYYY-MM-DD", unchanged if the visit ever moves). Optional, like `visitorType`, so
   * a response from an API older than 0036 still type-checks and simply reads as "not repeating".
   */
  seriesId?: string | null;
  occurrenceDate?: string | null;
  /**
   * Why a `cancelled` visit was cancelled. `skipped` is one series visit skipped (by the owner or
   * the customer's link) — the rows say "Skipped", not "Cancelled", for it.
   */
  cancelReason?: AppointmentCancelReason | null;
  /**
   * When the visit was moved by hand (migration 0037; Phase 2). Rows say "Moved", and a later
   * "change all future visits" leaves the visit at this time. Optional: older API.
   */
  rescheduledAt?: string | null;
}

export type AppointmentCancelReason = "skipped" | "cancelled" | "superseded";

/* Recurring appointments — backend/src/modules/appointments/series.service.ts (`seriesDTO`,
   `issueDTO`, `getSeries`). Hand-mirrored like everything else in this file: no compiler between. */

export type SeriesStatus = "active" | "paused" | "ended" | "cancelled";

/** Why a series is paused. Null while it is not paused. */
export type SeriesPauseReason = "owner" | "stylist_unavailable" | "no_shows";

export type SeriesEnd =
  | { type: "never" }
  | { type: "count"; count: number }
  | { type: "until"; date: string };

export interface SeriesRow {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  /** Null = any stylist — or, with `staffLocked`, a stylist who has since left. */
  staffId: string | null;
  staffName: string | null;
  /** True when the customer chose a stylist. With `staffId` null it means that stylist has gone. */
  staffLocked: boolean;
  /** Every service of the visit, joined the way the owner screens show them ("Haircut + Shave"). */
  serviceName: string | null;
  visitorType: "mr" | "patient" | null;
  /** Store-local time of day, "HH:mm". Never an instant: 10:00 must stay 10:00 across DST. */
  startTime: string;
  /** Store-local date of the first visit under the current rule, "YYYY-MM-DD". */
  anchorDate: string;
  everyDays: number;
  end: SeriesEnd;
  /** The last rule date, or null for a series that never ends. */
  lastDate: string | null;
  totalVisits: number | null;
  status: SeriesStatus;
  pauseReason: SeriesPauseReason | null;
  source: string;
  /** The next pending/confirmed visit still ahead, as a UTC instant. */
  nextVisitAt: string | null;
  /** Unresolved Needs attention items for this series. */
  openIssues: number;
  createdAt: string;
  updatedAt: string;
}

export type SeriesIssueReason = "outside_hours" | "stylist_unavailable" | "slot_taken" | "service_missing";

/** A series date the background job could not book — the owner's Needs attention list. */
export interface SeriesIssue {
  id: string;
  seriesId: string;
  customerName: string;
  customerPhone: string | null;
  staffId: string | null;
  staffName: string | null;
  serviceName: string | null;
  occurrenceDate: string;
  scheduledStartAt: string;
  reason: SeriesIssueReason;
  createdAt: string;
}

/** `GET /appointments/series/:id`, and the reply to pause / resume / cancel. */
export interface SeriesDetail {
  series: SeriesRow;
  /** The most recent 30 visits, oldest first. */
  visits: AppointmentRow[];
  issues: SeriesIssue[];
  /** Rule dates not booked yet (the job books each about three weeks ahead). Active series only. */
  laterDates: string[];
  /** The server's clock when it answered — what "upcoming" is measured against. */
  now: string;
  /**
   * The rule dates "Change future visits" may start from (store-local "YYYY-MM-DD"): today up to
   * the first date the job has not booked yet. Empty unless the series is active. Phase 2.
   */
  changeFromDates?: string[];
  /** The store's today, "YYYY-MM-DD". Phase 2. */
  today?: string;
}

/* Rescheduling — recurring appointments Phase 2 (backend reschedule.service.ts, series.service.ts).
   Times always travel as a slot's `startAt` instant from a slots endpoint: no client works out a
   store-local day or instant on its own clock. */

/** One bookable time. `label` is already worded on the store's clock ("2:00 PM"). */
export interface SlotOption {
  startAt: string;
  label: string;
}

/** `GET …/slots?date` — the times on `date`, plus the allowed range as store-local days. */
export interface SlotsResponse {
  date: string;
  slots: SlotOption[];
  today: string;
  lastDay: string;
}

/**
 * A date's fate under "change all future visits": `ok` takes the new time; `taken` must be given
 * another time or skipped before the change can go ahead; `kept` was moved by hand and keeps its
 * time; `skipped` was already skipped; `closed` falls on a closed day; `later` is past the
 * horizon and booked by the job later.
 */
export type ChangeDateStatus = "ok" | "taken" | "kept" | "skipped" | "closed" | "later";

export interface ChangePreview {
  fromDate: string;
  /** The new store-local "HH:mm". */
  startTime: string;
  staffId: string | null;
  dates: { date: string; startAt: string; status: ChangeDateStatus }[];
  /** The `taken` dates — each needs a resolution. */
  conflicts: string[];
}

/** What the owner chose for a `taken` date. */
export type ChangeResolution = { date: string; slotStart: string } | { date: string; skip: true };

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number;
  totalSpend: Money;
  lastVisitAt: string | null;
  /**
   * "Today" / "3d" / "2w" / "5mo" / "—", from `backend/src/lib/time.ts` `lastVisitLabel`. The app
   * shows exactly this string; optional so a response from an older API renders a dash, as the
   * app's mapper does.
   */
  lastVisitLabel?: string;
}

export interface DashboardSummary {
  range: ReportRange;
  periodLabel: string;
  date: string;
  /** Store-local first and last day of the period, and the store's today (optional: older API). */
  from?: string;
  to?: string;
  today?: string;
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
  /** False for a chair removed during the period — listed because it still did that work. */
  isActive?: boolean;
  appointments: number;
  completed: number;
  revenue: Money;
}

export interface DashboardByStaff {
  range: ReportRange;
  periodLabel: string;
  data: DashboardStaffRow[];
}

/* Commission — backend/src/modules/commission. Rates are basis points (2000 = 20%). */

/** One stretch paid at one rate. `from`/`to` are store-local wall times `YYYY-MM-DDTHH:mm`. */
export interface CommissionSegment {
  rateBp: number | null;
  from: string;
  to: string;
  visits: number;
  revenue: Money;
  commission: Money;
}

export interface CommissionStaffRow {
  staffId: string;
  name: string;
  isActive: boolean;
  visits: number;
  revenue: Money;
  commission: Money;
  /** Visits with no rate in force — they earn nothing. */
  unratedVisits: number;
  currentRateBp: number | null;
  currentRateFrom: string | null;
  /** The next scheduled change, as a store-local wall time. Owners only. */
  nextRate: { rateBp: number; from: string } | null;
  segments: CommissionSegment[];
}

export interface CommissionSummary {
  range: ReportRange;
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  /** `self` = a staff login reading its own earnings. */
  scope: "store" | "self";
  totals: { visits: number; revenue: Money; commission: Money; salonKeeps: Money | null };
  staff: CommissionStaffRow[];
  /** Visits with no stylist. Owners only. */
  unassigned: { visits: number; revenue: Money } | null;
}

export interface CommissionVisit {
  id: string;
  completedAt: string;
  /** The store's own day and clock for the visit, worked out by the API. */
  localDate: string;
  localTime: string;
  serviceName: string | null;
  /** Absent for a login without customer access. */
  customerName?: string | null;
  amount: Money;
  rateBp: number | null;
  commission: Money | null;
}

export interface CommissionVisits {
  range: ReportRange;
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  staff: { staffId: string; name: string; isActive: boolean };
  totals: { visits: number; revenue: Money; commission: Money };
  segments: CommissionSegment[];
  data: CommissionVisit[];
  meta: { shown: number; total: number; limit: number };
}

export interface CommissionRateItem {
  rateBp: number;
  /** UTC instant. DELETE sends this back. */
  from: string;
  /** Store-local `YYYY-MM-DDTHH:mm` for display. */
  fromLocal: string;
  /** The next rate's UTC instant, or null while this is the latest. */
  to: string | null;
  toLocal: string | null;
  /** Only a rate that has not started yet. A started rate is changed by saving a new one. */
  editable: boolean;
}

export interface CommissionStaffRates {
  staffId: string;
  name: string;
  current: CommissionRateItem | null;
  upcoming: CommissionRateItem[];
  history: CommissionRateItem[];
}

export interface CommissionRates {
  today: string;
  data: CommissionStaffRates[];
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
  /** Solid primary button only. Absent → buttons follow `brand`. */
  button?: string;
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
  yelpUrl: string;
  /** Where the post-visit review SMS points; '' = no review text is sent. Owner-side only. */
  googleReviewUrl: string;
  payments: string[];
  theme: ThemeConfig | null;
  themeColor: string | null;
  establishedYear: number | null;
  timezone: string;
  currency: string;
  plan: string;
  /**
   * Whether the store page offers "Repeat this booking?" (docs/recurring-appointments.md). The API
   * defaults it on; optional so a response from an API older than migration 0036 still type-checks.
   */
  recurringEnabled?: boolean;
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
export const getDashboard = (q: ReportQuery = { range: "today" }) =>
  getFresh<DashboardSummary>(`/dashboard/summary?${reportQueryString(q)}`);

/** Store-wide roles only; staff get 403 from the API. */
export const getDashboardByStaff = (q: ReportQuery = { range: "today" }) =>
  getFresh<DashboardByStaff>(`/dashboard/by-staff?${reportQueryString(q)}`);

/**
 * Commission, all uncached: a staff login's figures are its own chair's, and the cached `get` is
 * keyed by business + path only — it would hand one login's numbers to another.
 */
export const getCommissionSummary = (q: ReportQuery) =>
  getFresh<CommissionSummary>(`/commission/summary?${reportQueryString(q)}`);

/** One stylist's visits in the period. A staff login may only ask for its own chair (else 403). */
export const getCommissionVisits = (staffId: string, q: ReportQuery) =>
  getFresh<CommissionVisits>(`/commission/visits?staffId=${encodeURIComponent(staffId)}&${reportQueryString(q)}`);

/** Every active stylist's rates — owners only. */
export const getCommissionRates = () => getFresh<CommissionRates>("/commission/rates");

/**
 * Uncached, unlike `getAppointments` below. GET /appointments is narrowed to a staff login's own
 * chair (`scopeStaffId`), but `get()` keys its cache by business + path only — so an owner and a
 * staff login opening the same range share one entry, and whoever reads second sees the first
 * one's list for up to `TTL.appointments`: a staff login shown the whole shop's bookings, or an
 * owner shown one chair's.
 */
export const getAppointmentsFresh = (query = "") =>
  getFresh<{ data: AppointmentRow[] }>(`/appointments${query}`);

/**
 * The Regulars list (`open` = active + paused, the API's default). Uncached for the same reason as
 * getAppointmentsFresh: the API narrows it to a staff login's own chair (`scopeStaffId`), and a
 * business + path cache key would hand one login's regulars to another.
 */
export const getSeriesList = (status: "open" | "active" | "paused" | "ended" | "cancelled" | "all" = "open") =>
  getFresh<{ data: SeriesRow[] }>(`/appointments/series?status=${status}`);

/** Needs attention — series dates the job could not book. Chair-scoped for staff, so uncached too. */
export const getSeriesIssues = () => getFresh<{ data: SeriesIssue[] }>("/appointments/series/issues");

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
  get<{
    plan: string;
    status: string;
    trialEndsAt: string | null;
    /** How many customers a free store's list shows (`FREE_PLAN_CUSTOMER_LIMIT`); null on Premium. */
    limits?: { customerListLimit: number | null };
  }>(
    "/subscription",
    [TAGS.subscription],
    TTL.subscription,
  );
