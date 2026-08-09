import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

type Ctx = { params: Promise<{ id: string }> };

/** Edit a team login — name, number, role, linked chair, active/inactive. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/users/${id}`, { method: "PATCH" });
}

/**
 * Deactivate. Never a hard delete — visits, queue entries and the audit log all point back at
 * this row, and the backend revokes the account's live sessions on the way out.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/users/${id}`, { method: "DELETE" });
}
