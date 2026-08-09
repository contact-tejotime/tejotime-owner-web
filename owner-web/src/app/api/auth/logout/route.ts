import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin, BACKEND } from "@/lib/http";
import { ACCESS_COOKIE, getRefreshToken, REFRESH_COOKIE } from "@/lib/session";

/**
 * Sign out. Revokes the refresh session server-side, then clears both cookies.
 *
 * The cookies are cleared even if the backend call fails — a user who clicked "sign out" must
 * end up signed out locally regardless. The backend's own logout already swallows errors and
 * always reports success.
 */
export async function POST(req: NextRequest) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    try {
      await fetch(`${BACKEND}/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
    } catch {
      /* best effort — the cookie clear below is what the user sees */
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
