import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Replace the amenity list wholesale. Owner-role only, enforced by the backend. */
export async function PUT(req: NextRequest) {
  return forward(req, "/business/amenities", { method: "PUT", tags: [TAGS.business] });
}
