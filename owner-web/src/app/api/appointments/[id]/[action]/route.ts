import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";
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
    return NextResponse.json({ error: { message: t.api.unknownAction } }, { status: 404 });
  }
  return forward(req, `/appointments/${encodeURIComponent(id)}/${action}`, {
    tags: [TAGS.appointments, TAGS.queue, TAGS.dashboard],
  });
}
