import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

/**
 * A 60-second ticket for the backend's `/owner` socket.
 *
 * The access token is an httpOnly cookie and must stay one, so the browser never sees it. This
 * trades it (server-side) for a ticket that can only open a socket — the backend refuses it as a
 * REST bearer — and is dead a minute later. `LiveRefresh` asks again on every reconnect.
 */
export async function POST(req: NextRequest) {
  return forward(req, "/auth/socket-ticket", { body: {} });
}
