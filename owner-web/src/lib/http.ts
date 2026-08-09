import { NextRequest, NextResponse } from "next/server";

/** Backend base URL. Server-side runtime only — deliberately not NEXT_PUBLIC_. */
export const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

if (process.env.NODE_ENV === "production" && !process.env.BACKEND_API_BASE_URL) {
  console.error("[owner-web] BACKEND_API_BASE_URL is not set in production — every call will fail.");
}

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Reject cross-site requests to our mutation endpoints.
 *
 * `sameSite: 'lax'` on the session cookies stops the obvious CSRF, but it still permits
 * top-level GET navigations and does nothing about a sibling subdomain — and this app hosts
 * "delete staff" and "cancel subscription". `Sec-Fetch-Site` is sent by every browser we
 * support; `Origin` is the fallback for anything that isn't.
 *
 * Returns null when the request is fine, or the 403 to return.
 */
export function assertSameOrigin(req: NextRequest): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return null;

  if (!site) {
    const origin = req.headers.get("origin");
    // No Origin at all on a same-origin form post is normal for some older clients.
    if (!origin) return null;
    try {
      if (new URL(origin).host === req.nextUrl.host) return null;
    } catch {
      /* fall through to the rejection below */
    }
  }

  return NextResponse.json(
    { error: { message: "Cross-site request rejected." } },
    { status: 403 },
  );
}

/** Shape the backend returns on failure. */
export interface BackendError {
  error?: { code?: string; message?: string };
}

/** Uniform 502 when the API itself is unreachable, matching admin-panel's behaviour. */
export function unreachable(e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json(
    { error: { message: `Could not reach the API at ${BACKEND}: ${message}` } },
    { status: 502 },
  );
}
