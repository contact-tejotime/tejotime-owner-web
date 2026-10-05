import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid, slotsQuery } from "@/lib/proxy-route";

/**
 * Times a visit of this series could take on a day (`?date&staffId&fromDate`), at the length of
 * the series' services. With `fromDate` (a change's new time, or a conflict's other time) the
 * visits the change would replace do not block their own slots; without it (Book another time)
 * they do. Never cached.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = slotsQuery(req, ["date", "staffId", "fromDate"]);
  if (!isUuid(id) || query === null) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 400 });
  }
  return forward(req, `/appointments/series/${encodeURIComponent(id)}/slots?${query}`, { method: "GET" });
}
