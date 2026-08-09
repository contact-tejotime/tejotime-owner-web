import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

/**
 * Change your own password. Every login except the super owner's is created by someone else,
 * who therefore knows the initial password — so this is the first thing a new co-owner or
 * staff member should do.
 *
 * Deliberately NOT under /api/auth: the proxy matcher excludes that prefix (so the signed-out
 * login page can reach it), and this route needs the gate and the token refresh that come with
 * being inside it.
 */
export async function POST(req: NextRequest) {
  return forward(req, "/auth/password", { method: "POST" });
}
