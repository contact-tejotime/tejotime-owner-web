import { NextRequest, NextResponse } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Allow-listed, so this can't proxy arbitrary paths under /appointments/:id/. */
const ACTIONS = new Set(["check-in", "cancel", "no-show"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: { message: "Unknown action." } }, { status: 404 });
  }
  return forward(req, `/appointments/${encodeURIComponent(id)}/${action}`, {
    tags: [TAGS.appointments, TAGS.queue, TAGS.dashboard],
  });
}
