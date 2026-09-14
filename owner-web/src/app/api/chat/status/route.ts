import { NextResponse } from "next/server";

import { BACKEND, REQUEST_TIMEOUT_MS, unreachable } from "@/lib/http";

/**
 * Public chatbot flag for the owner portal launcher.
 *
 * No auth — the help widget must work on /login too. Proxies the backend's
 * GET /public/chat/status so the browser never learns BACKEND_API_BASE_URL.
 */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/public/chat/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({ enabled: false }));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return unreachable(e);
  }
}
