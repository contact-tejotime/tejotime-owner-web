import { unstable_cache, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminToken } from "./session";
import type {
  AdminCustomer,
  AppointmentsResponse,
  Category,
  CustomersResponse,
  PlatformCustomer,
  PlatformOverview,
  StoreAnalytics,
  StoreDetail,
  StoreListItem,
  StoreListItemWithMetrics,
  VisitsResponse,
} from "./types";

/**
 * Server-only read helpers — only ever imported by server components, so the admin JWT
 * never reaches the browser. On failure (backend down, or 401 from an expired token) they
 * degrade to empty/null so the panel still renders instead of crashing.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

// Fail loudly (in logs) rather than silently pointing production at localhost.
if (!process.env.BACKEND_API_BASE_URL && process.env.NODE_ENV === "production") {
  console.error(
    "[server-api] BACKEND_API_BASE_URL is not set in production — falling back to localhost; all admin reads will fail.",
  );
}

/** Abort a backend read that hangs instead of blocking the server render forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Cache windows (seconds) per data kind — "Balanced" profile. Your own edits are
 * reflected instantly via revalidateTag() in the mutation routes; these windows
 * only bound drift from live customer traffic between edits.
 */
const TTL = {
  businesses: 300, // store list / detail — 5 min
  lookups: 3600, // category master data — 1 hr
  analytics: 60, // dashboard KPIs / store analytics — 1 min
  activity: 120, // customers / visits / appointments — 2 min
} as const;

/** Cache-invalidation tags. revalidateTag(<tag>) in a mutation route refreshes them. */
export const TAGS = {
  businesses: "businesses",
  lookups: "lookups",
  analytics: "analytics",
  customers: "customers",
  visits: "visits",
  appointments: "appointments",
  business: (id: string) => `business:${id}`,
} as const;

/**
 * Immediately invalidate one or more cache tags — call from mutation route
 * handlers after a successful write so the next read is fresh. ("max" is Next 16's
 * required second arg; `updateTag` is Server-Action-only and can't be used here.)
 */
export function revalidateTags(...tags: string[]) {
  for (const t of tags) revalidateTag(t, "max");
}

/**
 * Shared read helper. The backend response is stored in the Next Data Cache keyed
 * by `path` and refreshed after `revalidate` seconds (or immediately when one of
 * its `tags` is revalidated). The admin JWT is read *outside* the cached function
 * (unstable_cache forbids cookies() inside it) and passed via closure, so it never
 * becomes part of the cache key — all admins share one platform-wide cache entry.
 *
 * Failures throw inside the cached fn so they are NOT cached (we retry next time);
 * the outer catch degrades to null and, on 401, redirects to /login.
 */
async function get<T>(path: string, tags: string[], revalidate: number): Promise<T | null> {
  const token = await getAdminToken();
  const load = unstable_cache(
    async (): Promise<T> => {
      const res = await fetch(`${BACKEND}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401) throw new Error("UNAUTHORIZED");
      if (!res.ok) throw new Error(`status-${res.status}`);
      return (await res.json()) as T;
    },
    [path], // cache key (token intentionally excluded)
    { tags, revalidate },
  );

  try {
    return await load();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // redirect() throws NEXT_REDIRECT (handled by Next); keep it out of the cached fn.
    if (msg === "UNAUTHORIZED") redirect("/login");
    console.error(`[server-api] GET ${path}: ${msg}`);
    return null;
  }
}

export async function listBusinesses(): Promise<StoreListItem[]> {
  const json = await get<{ data: StoreListItem[] }>("/admin/businesses", [TAGS.businesses], TTL.businesses);
  // The demo/example store is viewable only via the sidebar "View demo store" link — hide it
  // from the manageable Stores list so it isn't treated like a real store.
  return (json?.data ?? []).filter((s) => s.slug !== "demo-store");
}

export async function listLookups(type: string): Promise<Category[]> {
  const json = await get<{ data: Category[] }>(
    `/admin/lookups?type=${encodeURIComponent(type)}`,
    [TAGS.lookups],
    TTL.lookups,
  );
  return json?.data ?? [];
}

export async function getBusinessDetail(id: string): Promise<StoreDetail | null> {
  return get<StoreDetail>(`/admin/businesses/${id}`, [TAGS.businesses, TAGS.business(id)], TTL.businesses);
}

// ---- Analytics reads (all degrade to null/empty like the helpers above) ----

export async function listBusinessesWithMetrics(): Promise<StoreListItemWithMetrics[]> {
  const json = await get<{ data: StoreListItemWithMetrics[] }>(
    "/admin/businesses?withMetrics=1",
    [TAGS.businesses, TAGS.analytics],
    TTL.analytics,
  );
  return (json?.data ?? []).filter((s) => s.slug !== "demo-store");
}

export async function getPlatformOverview(): Promise<PlatformOverview | null> {
  return get<PlatformOverview>("/admin/analytics/overview", [TAGS.analytics, TAGS.businesses], TTL.analytics);
}

export async function getStoreAnalytics(id: string, range: "30d" | "90d"): Promise<StoreAnalytics | null> {
  return get<StoreAnalytics>(
    `/admin/businesses/${id}/analytics?range=${range}`,
    [TAGS.analytics, TAGS.business(id)],
    TTL.analytics,
  );
}

export async function listStoreCustomers(id: string, limit?: number): Promise<CustomersResponse | null> {
  const qs = limit ? `?limit=${limit}` : "";
  return get<CustomersResponse>(
    `/admin/businesses/${id}/customers${qs}`,
    [TAGS.customers, TAGS.business(id)],
    TTL.activity,
  );
}

/**
 * All customers across every store, merged by phone ("same phone across stores =
 * one customer"). There is no backend endpoint for this yet, so it fans out one
 * customers request per store (batched) and aggregates here — swap this function
 * for a real GET /admin/customers when it exists. Per-store results are capped at
 * the backend max (500), so the very oldest customers of a huge store may be missing.
 */
export async function listPlatformCustomers(): Promise<{
  customers: PlatformCustomer[];
  total: number;
  stores: StoreListItem[];
}> {
  const stores = await listBusinesses();

  const perStore: { store: StoreListItem; rows: AdminCustomer[] }[] = [];
  const BATCH = 10;
  for (let i = 0; i < stores.length; i += BATCH) {
    const batch = stores.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((s) => listStoreCustomers(s.id, 500)));
    batch.forEach((store, j) => perStore.push({ store, rows: results[j]?.data ?? [] }));
  }

  const merged = new Map<string, PlatformCustomer>();
  for (const { store, rows } of perStore) {
    for (const c of rows) {
      const digits = c.phone.replace(/\D/g, "");
      const key = digits || `${store.id}:${c.id}`;
      const membership = { storeId: store.id, customerId: c.id, storeName: store.name || "(unnamed)" };
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          key,
          name: c.name,
          phone: c.phone,
          isVip: c.isVip,
          visitsCount: c.visitsCount,
          lastVisitAt: c.lastVisitAt,
          lastVisitLabel: c.lastVisitLabel,
          totalSpend: c.totalSpend,
          notes: c.notes,
          createdAt: c.createdAt ?? null,
          memberships: [membership],
        });
        continue;
      }
      existing.memberships.push(membership);
      existing.visitsCount += c.visitsCount;
      existing.isVip = existing.isVip || c.isVip;
      // Spend sums only within one currency; on mismatch keep the primary store's figure.
      if (existing.totalSpend && existing.totalSpend.currency === c.totalSpend.currency) {
        existing.totalSpend = {
          amount: existing.totalSpend.amount + c.totalSpend.amount,
          currency: existing.totalSpend.currency,
        };
      }
      // The customer "joined" the platform when their earliest store record was created.
      if (c.createdAt && (!existing.createdAt || c.createdAt < existing.createdAt)) {
        existing.createdAt = c.createdAt;
      }
      // The most recently visited record wins name/notes/last-visit (and becomes "primary").
      if ((c.lastVisitAt ?? "") > (existing.lastVisitAt ?? "")) {
        existing.name = c.name;
        existing.notes = c.notes ?? existing.notes;
        existing.lastVisitAt = c.lastVisitAt;
        existing.lastVisitLabel = c.lastVisitLabel;
      }
    }
  }

  const customers = [...merged.values()].sort((a, b) => (b.lastVisitAt ?? "").localeCompare(a.lastVisitAt ?? ""));
  return { customers, total: customers.length, stores };
}

export async function listStoreVisits(id: string, from?: string, to?: string): Promise<VisitsResponse | null> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return get<VisitsResponse>(
    `/admin/businesses/${id}/visits${qs ? `?${qs}` : ""}`,
    [TAGS.visits, TAGS.business(id)],
    TTL.activity,
  );
}

export async function listStoreAppointments(
  id: string,
  opts: { from?: string; to?: string; status?: string } = {},
): Promise<AppointmentsResponse | null> {
  const params = new URLSearchParams();
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.status) params.set("status", opts.status);
  const qs = params.toString();
  return get<AppointmentsResponse>(
    `/admin/businesses/${id}/appointments${qs ? `?${qs}` : ""}`,
    [TAGS.appointments, TAGS.business(id)],
    TTL.activity,
  );
}
