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

async function get<T>(path: string): Promise<T | null> {
  try {
    const token = await getAdminToken();
    const res = await fetch(`${BACKEND}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listBusinesses(): Promise<StoreListItem[]> {
  const json = await get<{ data: StoreListItem[] }>("/admin/businesses");
  // The demo/example store is viewable only via the sidebar "View demo store" link — hide it
  // from the manageable Stores list so it isn't treated like a real store.
  return (json?.data ?? []).filter((s) => s.slug !== "demo-store");
}

export async function listLookups(type: string): Promise<Category[]> {
  const json = await get<{ data: Category[] }>(`/admin/lookups?type=${encodeURIComponent(type)}`);
  return json?.data ?? [];
}

export async function getBusinessDetail(id: string): Promise<StoreDetail | null> {
  return get<StoreDetail>(`/admin/businesses/${id}`);
}

// ---- Analytics reads (all degrade to null/empty like the helpers above) ----

export async function listBusinessesWithMetrics(): Promise<StoreListItemWithMetrics[]> {
  const json = await get<{ data: StoreListItemWithMetrics[] }>("/admin/businesses?withMetrics=1");
  return (json?.data ?? []).filter((s) => s.slug !== "demo-store");
}

export async function getPlatformOverview(): Promise<PlatformOverview | null> {
  return get<PlatformOverview>("/admin/analytics/overview");
}

export async function getStoreAnalytics(id: string, range: "30d" | "90d"): Promise<StoreAnalytics | null> {
  return get<StoreAnalytics>(`/admin/businesses/${id}/analytics?range=${range}`);
}

export async function listStoreCustomers(id: string, limit?: number): Promise<CustomersResponse | null> {
  const qs = limit ? `?limit=${limit}` : "";
  return get<CustomersResponse>(`/admin/businesses/${id}/customers${qs}`);
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
  return get<VisitsResponse>(`/admin/businesses/${id}/visits${qs ? `?${qs}` : ""}`);
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
  return get<AppointmentsResponse>(`/admin/businesses/${id}/appointments${qs ? `?${qs}` : ""}`);
}
