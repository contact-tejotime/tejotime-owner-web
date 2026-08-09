import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/staff/${encodeURIComponent(id)}`, { tags: [TAGS.staff, TAGS.queue] });
}

/** Soft delete. 409s when the seat still has live queue entries. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/staff/${encodeURIComponent(id)}`, {
    method: "DELETE",
    tags: [TAGS.staff, TAGS.queue],
  });
}
