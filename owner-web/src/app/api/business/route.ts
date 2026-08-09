import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/** Business profile. PATCH is partial — only the keys sent are written. */
export async function PATCH(req: NextRequest) {
  return forward(req, "/business", { tags: [TAGS.business] });
}
