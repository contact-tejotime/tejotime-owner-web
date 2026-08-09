import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  accessTokenIsFresh,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
} from "@/lib/session-cookie";

/**
 * Auth gate and token refresh (Next 16 "proxy", formerly middleware).
 *
 * Two jobs:
 *
 * 1. **Gate.** No refresh cookie ⇒ redirect pages to /login, 401 the API. It checks the REFRESH
 *    cookie, not the access cookie: the access token lives 15 minutes, so gating on it would
 *    bounce a signed-in user to /login every time they came back from lunch.
 *
 * 2. **Refresh.** The access token expires far more often than a user's session does, and
 *    Server Components cannot write cookies — only route handlers and this proxy can. So the
 *    rotation happens here, once per request that needs it, and every downstream Server
 *    Component then reads a cookie that is already fresh.
 *
 * The backend ROTATES on refresh (old auth_session revoked, new pair issued), so a double
 * refresh would revoke the token the other request just received. That is why the matcher
 * excludes static assets and why this only runs for real navigations and API calls — a page
 * load refreshes once on the document, and the client fetches that follow reuse that cookie.
 *
 * Presence and expiry are the only things checked here; the backend verifies every signature.
 */
export async function proxy(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return signedOut(req);

  if (accessTokenIsFresh(req.cookies.get(ACCESS_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const backend = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";
  let refreshed: Response;
  try {
    refreshed = await fetch(`${backend}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
  } catch {
    // The API is unreachable. Let the request through rather than signing the user out over a
    // transient network fault — the downstream call will surface the real error.
    return NextResponse.next();
  }

  if (!refreshed.ok) {
    // A refused refresh means the session is genuinely gone (revoked, expired, user
    // deactivated). Clear both cookies so the user lands on a clean login.
    const res = signedOut(req);
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  const json = (await refreshed.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
  };
  if (!json.accessToken || !json.refreshToken) return NextResponse.next();

  const res = NextResponse.next();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  res.cookies.set(ACCESS_COOKIE, json.accessToken, { ...opts, maxAge: ACCESS_MAX_AGE_SECONDS });
  res.cookies.set(REFRESH_COOKIE, json.refreshToken, { ...opts, maxAge: REFRESH_MAX_AGE_SECONDS });
  return res;
}

function signedOut(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip the gate for the login page, the auth endpoints it posts to, Next internals, and
  // public static files — otherwise the unauthenticated login page's own <img> requests get
  // redirected to HTML and render as broken images. Excluding static assets also keeps the
  // refresh above from firing many times per page load.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
