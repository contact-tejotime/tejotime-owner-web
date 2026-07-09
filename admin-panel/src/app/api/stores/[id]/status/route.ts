import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { fromDetail, toPayload, type StoreDetail } from "@/lib/types";

/**
 * Toggle a store's isActive flag. The backend's update schema is strict and
 * requires the FULL store body (a partial `{isActive}` PUT is rejected), so this
 * route does a server-side read-modify-write: GET the detail, rebuild the payload
 * with the flag flipped, PUT it back.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }

  let isActive: boolean;
  try {
    const body = (await req.json()) as { isActive?: unknown };
    if (typeof body.isActive !== "boolean") throw new Error();
    isActive = body.isActive;
  } catch {
    return NextResponse.json({ error: { message: "Body must be { isActive: boolean }." } }, { status: 400 });
  }

  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

  let detail: StoreDetail;
  try {
    const res = await fetch(`${BACKEND}/admin/businesses/${id}`, { headers, cache: "no-store" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return NextResponse.json(json, { status: res.status });
    }
    detail = (await res.json()) as StoreDetail;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to reach backend";
    return NextResponse.json(
      { error: { message: `Could not reach the backend API at ${BACKEND}. Is it running? (${message})` } },
      { status: 502 },
    );
  }

  const body = toPayload({ ...fromDetail(detail), isActive }, false);
  // fromDetail backfills weekdays the store never listed as open 09:00–18:00 (a
  // form-editing convenience). A status toggle must not invent opening hours, so
  // send back exactly the rows the backend returned.
  body.hours = detail.hours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    opensAt: h.isClosed ? null : h.opensAt || null,
    closesAt: h.isClosed ? null : h.closesAt || null,
    isClosed: h.isClosed,
  }));

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/businesses/${id}`, {
      method: "PUT",
      headers,
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

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  }
  return NextResponse.json({ isActive });
}
