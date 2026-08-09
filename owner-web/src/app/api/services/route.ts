import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

export async function POST(req: NextRequest) {
  return forward(req, "/services", { tags: [TAGS.services] });
}
