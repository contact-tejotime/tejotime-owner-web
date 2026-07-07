import { getAdminToken } from "./session";
import type { Category, StoreDetail, StoreListItem } from "./types";

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
  return json?.data ?? [];
}

export async function listLookups(type: string): Promise<Category[]> {
  const json = await get<{ data: Category[] }>(`/admin/lookups?type=${encodeURIComponent(type)}`);
  return json?.data ?? [];
}

export async function getBusinessDetail(id: string): Promise<StoreDetail | null> {
  return get<StoreDetail>(`/admin/businesses/${id}`);
}
