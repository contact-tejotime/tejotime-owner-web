import type { Category, StoreDetail, StoreListItem } from "./types";

/**
 * Server-only read helpers — only ever imported by server components, so the x-admin-key header
 * never reaches the browser. On failure they degrade to empty/null so the panel still renders
 * (e.g. shows an empty store list) instead of crashing when the backend is down.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      headers: { "x-admin-key": ADMIN_KEY },
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
  return json?.data ?? [];
}

export async function listLookups(type: string): Promise<Category[]> {
  const json = await get<{ data: Category[] }>(`/admin/lookups?type=${encodeURIComponent(type)}`);
  return json?.data ?? [];
}

export async function getBusinessDetail(id: string): Promise<StoreDetail | null> {
  return get<StoreDetail>(`/admin/businesses/${id}`);
}
