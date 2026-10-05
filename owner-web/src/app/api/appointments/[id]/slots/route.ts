import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid, slotsQuery } from "@/lib/proxy-route";

/**
 * The times one booking could move to on a day (`?date=YYYY-MM-DD&staffId=uuid|any`), for the
 * Reschedule sheet. `staffId` absent = the booking's own stylist. The reply carries the owner's
 * allowed range (`today` … `lastDay`, today+60) as store-local days, which the sheet's date input
 * uses as its min and max.
 *
 * Read through `forward` (it carries the token and the same-origin check) and never cached: the
 * answer changes with every booking.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = slotsQuery(req, ["date", "staffId"]);
  if (!isUuid(id) || query === null) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 400 });
  }
  return forward(req, `/appointments/${encodeURIComponent(id)}/slots?${query}`, { method: "GET" });
}
