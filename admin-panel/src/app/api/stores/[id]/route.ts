import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { TAGS, revalidateTags } from "@/lib/server-api";
import { t, format } from "@/i18n";

/**
 * Server-side proxy for editing a store: PUT the form JSON to the backend's update endpoint,
 * attaching the admin JWT as a Bearer token. Keeps the token off the browser and avoids CORS.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
    res = await fetch(`${BACKEND}/admin/businesses/${id}`, {
      method: "PUT",
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
    // Refresh this store's detail + the list/metrics that show its name & status.
    revalidateTags(TAGS.business(id), TAGS.businesses, TAGS.analytics);
  }
  return NextResponse.json(json, { status: res.status });
}
