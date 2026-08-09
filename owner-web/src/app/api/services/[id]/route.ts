import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/services/${encodeURIComponent(id)}`, { tags: [TAGS.services] });
}

/** Soft delete — the backend sets is_active=false so historical rows keep their service link. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/services/${encodeURIComponent(id)}`, {
    method: "DELETE",
    tags: [TAGS.services],
  });
}
