import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { t, format } from "@/i18n";

/**
 * Server-side proxy for "autofill a store from a link". The backend does the fetching and the
 * LLM call (so the page fetch is SSRF-guarded in one place and the Groq key never leaves the
 * server); this just attaches the admin JWT. Read-only — nothing is written, so there is nothing
 * to revalidate.
 *
 * `maxDuration` is generous on purpose: the backend gives the page fetch up to 10s and the model
 * up to 20s, and cutting the proxy short would turn a slow-but-working import into a 504.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: t.api.notAuthenticated } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: t.api.invalidJson } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/store-import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : t.api.failedToReach;
    return NextResponse.json(
      { error: { message: format(t.api.backendUnreachable, { backend: BACKEND, message }) } },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
