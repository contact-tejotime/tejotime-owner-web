import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

/** Owner resets a team member's password. Signs that account out everywhere. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/users/${id}/password`, { method: "POST" });
}
