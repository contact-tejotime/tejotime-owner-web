import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { TAGS, revalidateTags } from "@/lib/server-api";
import { t, format } from "@/i18n";

/**
 * Rename, reset password, or deactivate one employee. Owner-only, enforced by the backend
 * (403 otherwise) — see the note in ../route.ts about not duplicating that rule here.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: t.api.notAuthenticated } }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: t.api.invalidJson } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/admins/${id}`, {
      method: "PATCH",
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
  // Deactivating an employee changes nothing about which stores exist, only who may reach
  // them — so the store tags are deliberately left alone.
  if (res.ok) revalidateTags(TAGS.admins);
  return NextResponse.json(json, { status: res.status });
}
