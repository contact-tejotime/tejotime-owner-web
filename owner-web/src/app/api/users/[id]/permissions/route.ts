import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

/**
 * Replace a staff login's module permissions.
 *
 * The editor always sends the complete map, so a module reset to its role default disappears
 * from `user_permission` rather than lingering as a stale override.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/users/${id}/permissions`, { method: "PUT" });
}
