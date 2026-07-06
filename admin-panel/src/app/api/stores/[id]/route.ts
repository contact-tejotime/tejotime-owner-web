import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for editing a store: PUT the form JSON to the backend's x-admin-key–gated
 * update endpoint. Keeps ADMIN_API_KEY off the browser and avoids CORS (server → server).
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ADMIN_KEY) {
    return NextResponse.json(
      { error: { message: "Server misconfigured: ADMIN_API_KEY is not set in admin-panel env." } },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body." } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/businesses/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to reach backend";
    return NextResponse.json(
      { error: { message: `Could not reach the backend API at ${BACKEND}. Is it running? (${message})` } },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
