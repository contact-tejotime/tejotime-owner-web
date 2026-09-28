import { NextResponse, type NextRequest } from "next/server";

import { API_BASE_URL } from "@/lib/config";

/**
 * Review short link — `www.tejotime.com/<phone>/r`.
 *
 * The post-visit review SMS carries this instead of the store's raw Google review URL: carriers
 * filter bit.ly-style public shorteners, and Google's write-review URLs are long enough to push a
 * text into extra segments. So we shorten on our own domain — the same one as the opt-in page.
 *
 * The link is read live from the API on every click (never cached), so an owner who changes their
 * Google link later still reaches customers holding an older text. 302, not 301, for the same
 * reason: a permanent redirect would be cached by the phone's browser.
 *
 * No error screen of its own: a malformed phone goes to the homepage, and anything else without a
 * usable link (no link set, unknown store, API down) goes to `/<phone>` — the store's booking page,
 * which shows its usual not-found page if the store does not exist.
 */

export const dynamic = "force-dynamic";

function redirect(to: string | URL) {
  const res = NextResponse.redirect(to, 302);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  // Same guard as the microsite and /card routes: only digit strings are phone URLs.
  if (!/^\d{7,15}$/.test(phone)) return redirect(new URL("/", req.url));

  try {
    const res = await fetch(`${API_BASE_URL}/public/businesses/by-phone/${phone}/review-link`, {
      cache: "no-store",
    });
    if (res.ok) {
      const { url } = (await res.json()) as { url?: string };
      // The API only ever stores https links; re-check rather than redirect to anything else.
      if (url && /^https:\/\//i.test(url)) return redirect(url);
    }
  } catch {
    // API unreachable — fall through to the store page rather than an error screen.
  }
  return redirect(new URL(`/${phone}`, req.url));
}
