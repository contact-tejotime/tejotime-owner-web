import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * Series controls. Allow-listed, like the appointment and queue action routes, so this cannot
 * proxy arbitrary paths under /appointments/series/:id/ with the caller's token.
 *
 * - pause  → stops new visits; the ones already booked stay (the owner can skip any of them).
 * - resume → `{ staffId?: uuid | "any" }`. Required by the API (400, field `staffId`) when the
 *            series was paused because its stylist left. Books any dates already inside the
 *            horizon straight away.
 * - cancel → cancels every upcoming visit and stops the series for good.
 *
 * Each answers with the full series detail. None of them texts the customer (decided with the
 * client) — the sheet tells the owner to phone instead.
 *
 * Tags: resume and cancel create or cancel visits, which today's appointment counts on Home read
 * (`dashboard`); the appointment reads here are uncached, but `getAppointments` is not.
 */
const ACTIONS = new Set(["pause", "resume", "cancel"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action) || !isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.unknownAction } }, { status: 404 });
  }
  return forward(req, `/appointments/series/${encodeURIComponent(id)}/${action}`, {
    tags: [TAGS.appointments, TAGS.dashboard],
  });
}
