import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { assertSameOrigin, BACKEND, REQUEST_TIMEOUT_MS, unreachable } from "./http";
import { revalidateTags } from "./server-api";
import { getAccessToken } from "./session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For routes that splice a path parameter into the backend path. `encodeURIComponent` does not
 * stop a `..` segment, which `fetch` would then normalise into a different backend path; every id
 * the API takes is a UUID, so anything else is refused here instead of being forwarded.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * A slots route's query string, rebuilt from an allow-list rather than passed through, so a GET
 * route cannot be used to send the backend parameters it was never meant to take. `date` and
 * `fromDate` must be "YYYY-MM-DD"; `staffId` a UUID or "any".
 */
export function slotsQuery(req: NextRequest, keys: ("date" | "staffId" | "fromDate")[]): string | null {
  const out = new URLSearchParams();
  for (const key of keys) {
    const value = req.nextUrl.searchParams.get(key);
    if (value === null || value === "") continue;
    const ok = key === "staffId" ? value === "any" || isUuid(value) : /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!ok) return null;
    out.set(key, value);
  }
  return out.toString();
}

/**
 * Shared body for every mutation route handler.
 *
 * The browser never calls the backend directly: it calls a same-origin `/api/*` route, which
 * attaches the httpOnly access token as a Bearer header and forwards. Same shape as
 * admin-panel's handlers, plus an explicit cross-site check — `sameSite: 'lax'` alone is thin
 * protection for a subdomain hosting destructive actions.
 *
 * `tags` are revalidated only on success, so a failed write cannot flush good cache entries.
 */
export async function forward(
  req: NextRequest,
  path: string,
  opts: { method?: string; tags?: string[]; body?: unknown } = {},
): Promise<NextResponse> {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: { message: t.api.notAuthenticated } }, { status: 401 });
  }

  const method = opts.method ?? req.method;
  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE") {
    const payload = opts.body !== undefined ? opts.body : await req.json().catch(() => ({}));
    body = JSON.stringify(payload ?? {});
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    return unreachable(e);
  }

  const json = await res.json().catch(() => ({}));
  if (res.ok && opts.tags?.length) revalidateTags(...opts.tags);
  return NextResponse.json(json, { status: res.status });
}
