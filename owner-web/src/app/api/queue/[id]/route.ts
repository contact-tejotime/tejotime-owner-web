import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * One entry's detail — seat, service, source, position, and the price breakdown the checkout
 * sheet pre-fills from.
 *
 * Fetched on demand when a card is opened rather than embedded in the board payload: the board
 * renders a dozen cards and almost none of them get opened, and the billing figures behind this
 * cost two extra joins each.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/queue/${encodeURIComponent(id)}`, { method: "GET" });
}

/** Remove someone from the queue (they left). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/queue/${encodeURIComponent(id)}`, {
    method: "DELETE",
    tags: [TAGS.queue, TAGS.dashboard],
  });
}
