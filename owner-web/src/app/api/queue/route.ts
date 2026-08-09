import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Add a walk-in. The backend allocates the token and seat via the queue_add RPC. */
export async function POST(req: NextRequest) {
  return forward(req, "/queue", { tags: [TAGS.queue, TAGS.dashboard, TAGS.customers] });
}
