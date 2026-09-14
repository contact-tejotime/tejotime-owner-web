import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { assertSameOrigin, BACKEND, REQUEST_TIMEOUT_MS, unreachable } from "@/lib/http";

/**
 * Owner-portal help chat — proxies POST /public/chat (product FAQ bot).
 *
 * No Bearer token: this is the same read-only public endpoint the marketing site
 * uses. Same-origin check still applies so a third-party page cannot burn our
 * chat rate limit through this BFF.
 */
export async function POST(req: NextRequest) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}/public/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return unreachable(e);
  }
}
