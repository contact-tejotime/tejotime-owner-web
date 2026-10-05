import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * "Book another time" on a Needs attention item (Phase 2): `{ slotStart, staffId? }` books that one
 * flagged date at the time the owner picked, and closes the item as booked. 201 with the new
 * visit. No SMS — the owner phones the customer.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  if (!isUuid(issueId)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/appointments/series/issues/${encodeURIComponent(issueId)}/book`, {
    tags: [TAGS.appointments, TAGS.dashboard],
  });
}
