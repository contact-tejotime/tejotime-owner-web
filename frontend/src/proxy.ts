import { NextRequest, NextResponse } from "next/server";

/**
 * Host-scoped redirect (Next 16 "proxy", formerly middleware).
 *
 * The same `frontend/` builds two deployments:
 *   - Render (tejotime-owner.onrender.com) — should redirect to the canonical domain.
 *   - Vercel (www.tejotime.com)            — should serve the site.
 * A next.config `redirects()` can't read the request Host, so we branch on it here:
 * only requests arriving at the Render host are 308-redirected to www.tejotime.com
 * (path + query preserved). Every other host — www.tejotime.com, localhost, previews —
 * passes through, so this is inert on Vercel and in local dev (no redirect loop).
 */
const RENDER_HOST = "tejotime-owner.onrender.com";
const CANONICAL_ORIGIN = "https://www.tejotime.com";

export function proxy(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase();
  if (host === RENDER_HOST) {
    const { pathname, search } = req.nextUrl;
    return NextResponse.redirect(new URL(pathname + search, CANONICAL_ORIGIN), 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
