import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Replace the gallery wholesale — order is the array order. Owner-role only. */
export async function PUT(req: NextRequest) {
  return forward(req, "/business/gallery", { method: "PUT", tags: [TAGS.business] });
}
