import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, slotsQuery } from "@/lib/proxy-route";

/**
 * The free times for a NEW booking (`?date=YYYY-MM-DD&serviceIds=a,b&staffId=uuid|any`) — the
 * booking sheet's "Book a visit" from the "Due to come back" list. The length comes from the
 * services; the reply carries the owner's range (`today` … `lastDay`, today+60) as store-local days.
 *
 * Never cached: the answer changes with every booking.
 */
export async function GET(req: NextRequest) {
  const query = slotsQuery(req, ["date", "staffId", "serviceIds"]);
  if (query === null) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 400 });
  }
  return forward(req, `/appointments/slots?${query}`, { method: "GET" });
}
