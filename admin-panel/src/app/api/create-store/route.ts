import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { TAGS, revalidateTags } from "@/lib/server-api";
import { t, format } from "@/i18n";

/**
 * Server-side proxy: takes the create-store form JSON from the browser and forwards it to the
 * backend's provisioning endpoint, attaching the admin JWT as a Bearer token. Running server-side
 * keeps the token off the browser bundle and avoids CORS (server → server).
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

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
    res = await fetch(`${BACKEND}/admin/businesses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : t.api.failedToReach;
    return NextResponse.json(
      { error: { message: format(t.api.backendUnreachable, { backend: BACKEND, message }) } },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  if (res.ok) {
    // A new store changes the store list and the platform overview counts.
    revalidateTags(TAGS.businesses, TAGS.analytics);
  }
  return NextResponse.json(json, { status: res.status });
}
