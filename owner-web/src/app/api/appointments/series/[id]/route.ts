import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * One repeating booking — the series, its recent visits, its open Needs attention items and the
 * rule dates not booked yet. Read by the series sheet when it opens (docs/recurring-appointments.md).
 *
 * Through the BFF like every other call (the browser never holds the token), and never cached: the
 * API refuses a staff login another chair's series, so a shared entry could leak one.
 *
 * This folder sits beside `appointments/[id]`; Next ranks the static `series` segment first, so
 * `/api/appointments/series/…` can never be read as an appointment id.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/appointments/series/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * Change all future visits (Phase 2): `{ fromDate, slotStart?, staffId?, resolutions? }`. Answers
 * with the series detail, or 409 CHANGE_CONFLICTS whose `details[].rule` are the dates that still
 * need another time or a skip — nothing is written then. Texts nobody.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/appointments/series/${encodeURIComponent(id)}`, {
    tags: [TAGS.appointments, TAGS.dashboard],
  });
}
