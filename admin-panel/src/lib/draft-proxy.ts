import { NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";
import { TAGS, revalidateTags } from "@/lib/server-api";
import { t, format } from "@/i18n";

/**
 * Shared body of the store-draft route handlers: attach the admin JWT server-side, forward to the
 * backend, relay the status, and refresh the sidebar's Drafts list after a successful write.
 * Same shape as create-store/route.ts; only here because three handlers would repeat it verbatim.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function proxyDraft(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  req?: Request,
): Promise<NextResponse> {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: t.api.notAuthenticated } }, { status: 401 });
  }

  let body: string | undefined;
  if (req) {
    try {
      body = JSON.stringify(await req.json());
    } catch {
      return NextResponse.json({ error: { message: t.api.invalidJson } }, { status: 400 });
    }
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body,
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : t.api.failedToReach;
    return NextResponse.json(
      { error: { message: format(t.api.backendUnreachable, { backend: BACKEND, message }) } },
      { status: 502 },
    );
  }

  if (res.ok) revalidateTags(TAGS.drafts);
  // DELETE answers 204 with no body, which NextResponse.json cannot relay.
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
