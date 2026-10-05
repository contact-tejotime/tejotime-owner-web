import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";

/**
 * "Mark handled" on a Needs attention item — the owner has phoned the customer and sorted the
 * date out. No cache tags: the only reads of the list (`getSeriesIssues`, the series detail) are
 * uncached, so there is nothing to flush.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  if (!isUuid(issueId)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/appointments/series/issues/${encodeURIComponent(issueId)}/resolve`);
}
