import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin, BACKEND, unreachable } from "@/lib/http";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  cookieOptions,
  getRefreshToken,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
} from "@/lib/session";

/**
 * Explicit token rotation.
 *
 * The proxy already refreshes on any navigation or API call, so this exists for the one case
 * it cannot cover: a long-lived page (the live queue) whose Socket.IO connection needs a valid
 * access token handed to it directly, without a navigation to trigger the proxy.
 *
 * Excluded from the proxy's matcher, so it works even when the access cookie is already dead.
 */
export async function POST(req: NextRequest) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
  } catch (e) {
    return unreachable(e);
  }

  const json = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
  };

  if (!res.ok || !json.accessToken || !json.refreshToken) {
    const dead = NextResponse.json(
      { error: { message: "Session expired. Please sign in again." } },
      { status: 401 },
    );
    dead.cookies.delete(ACCESS_COOKIE);
    dead.cookies.delete(REFRESH_COOKIE);
    return dead;
  }

  const ok = NextResponse.json({ ok: true });
  ok.cookies.set(ACCESS_COOKIE, json.accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS));
  ok.cookies.set(REFRESH_COOKIE, json.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
  return ok;
}
