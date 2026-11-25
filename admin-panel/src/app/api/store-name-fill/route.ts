import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { t, format } from "@/i18n";

/**
 * Server-side proxy for the "autofill a store from a business name" FILL step. The backend reads the
 * Google place, the business website and the photos, writes the copy, and copies photos into our
 * bucket — all server-side. `maxDuration` is generous because a fill does several outbound calls; the
 * backend bounds each one. Read-only — nothing is written to a store until the admin saves.
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
    res = await fetch(`${BACKEND}/admin/store-name-fill`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
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
