import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

const ACTIONS = new Set(["upgrade", "cancel"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: { message: t.api.unknownAction } }, { status: 404 });
  }
  return forward(req, `/subscription/${action}`, {
    method: "POST",
    body: {},
    tags: [TAGS.subscription, TAGS.customers],
  });
}
