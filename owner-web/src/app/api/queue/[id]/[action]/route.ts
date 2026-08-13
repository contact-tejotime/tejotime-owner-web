import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * Queue entry actions, one handler for the whole set.
 *
 * `action` is checked against an allow-list rather than passed through — otherwise this route
 * would proxy arbitrary paths under /queue/:id/ with the caller's token.
 */
const ACTIONS = new Set(["start", "checkout", "no-show", "reassign", "extend", "move"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: { message: t.api.unknownAction } }, { status: 404 });
  }
  return forward(req, `/queue/${encodeURIComponent(id)}/${action}`, {
    tags: [TAGS.queue, TAGS.dashboard, TAGS.customers],
  });
}
