import { NextRequest, NextResponse } from "next/server";
import { t } from "@/i18n";

import { forward, isUuid } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * What a call to a "Due to come back" customer achieved (docs/customer-due-list.md).
 *   PUT    `{ outcome: "no_answer" }` | `{ outcome: "call_later", callBackOn }` | `{ outcome: "not_interested" }`
 *   DELETE  undo — the customer is back on the list (if still due).
 */
async function send(req: NextRequest, params: Promise<{ id: string }>, method: "PUT" | "DELETE") {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { message: t.api.invalidRequest } }, { status: 404 });
  }
  return forward(req, `/customers/${encodeURIComponent(id)}/followup`, { method, tags: [TAGS.customers] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return send(req, params, "PUT");
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return send(req, params, "DELETE");
}
