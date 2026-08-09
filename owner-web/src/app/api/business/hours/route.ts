import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Weekly opening hours — a full replace of all seven rows, as the backend expects. */
export async function PUT(req: NextRequest) {
  return forward(req, "/business/hours", { tags: [TAGS.business] });
}
