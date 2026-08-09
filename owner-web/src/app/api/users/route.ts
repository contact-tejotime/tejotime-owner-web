import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";

/** Create a co-owner or staff login. The backend refuses anyone who is not an owner role. */
export async function POST(req: NextRequest) {
  return forward(req, "/users", { method: "POST" });
}
