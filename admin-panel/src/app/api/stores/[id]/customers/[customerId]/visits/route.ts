import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";

const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

/**
 * Read proxy for the customer-drawer visit history — the only analytics read the
 * browser makes directly (everything else is fetched by server components).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await ctx.params;
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }
  try {
    const res = await fetch(`${BACKEND}/admin/businesses/${id}/customers/${customerId}/visits`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ error: { message: "Backend unreachable" } }, { status: 502 });
  }
}
