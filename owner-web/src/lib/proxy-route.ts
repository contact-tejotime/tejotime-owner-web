import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { assertSameOrigin, BACKEND, REQUEST_TIMEOUT_MS, unreachable } from "./http";
import { revalidateTags } from "./server-api";
import { getAccessToken } from "./session";

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
