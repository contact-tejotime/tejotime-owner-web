import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Fast auth gate (Next 16 "proxy", formerly middleware): if there's no session
 * cookie, redirect page requests to /login (and reject API requests with 401)
 * before any protected content renders. This is only a presence check for snappy
 * UX — the (protected) layout does the authoritative signature verification in
 * the Node runtime. The matcher excludes /login, the admin-auth endpoints, and
 * static assets.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip auth gate for login, OTP auth APIs, Next internals, and public static files
  // (e.g. /logo.png). Without this, unauthenticated login-page <img> requests get
  // redirected to HTML and show as a broken image.
  matcher: [
    "/((?!login|api/admin-auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
