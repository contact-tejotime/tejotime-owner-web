import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";
import { forward, isUuid } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * Allow-listed, so this can't proxy arbitrary paths under /appointments/:id/. `skip` is one visit
 * of a repeating booking (the API answers 400 for a one-off); `reschedule` moves any booking,
 * one-off or series, and carries a body (`{ slotStart, staffId? }`, which `forward` passes
 * through). None of them texts the customer.
 */
const ACTIONS = new Set(["check-in", "cancel", "no-show", "skip", "reschedule"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action) || !isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.unknownAction } }, { status: 404 });
  }
  return forward(req, `/appointments/${encodeURIComponent(id)}/${action}`, {
    tags: [TAGS.appointments, TAGS.queue, TAGS.dashboard],
  });
}
