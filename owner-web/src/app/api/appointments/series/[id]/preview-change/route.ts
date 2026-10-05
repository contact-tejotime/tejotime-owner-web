import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";

/**
 * What "change all future visits" would do — each date's fate and the dates that need a choice —
 * without writing anything. A POST only because it carries a body. Its own folder (Next ranks the
 * static segment above `[action]`) so it needs no cache tags: nothing changes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/appointments/series/${encodeURIComponent(id)}/preview-change`);
}
