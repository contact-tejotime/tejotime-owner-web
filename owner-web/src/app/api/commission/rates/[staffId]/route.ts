import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";

/**
 * Set a stylist's commission rate from a day (`{ rateBp, effectiveFrom? }`). Owners only — the
 * backend refuses everyone else. No cache tags: every commission read is uncached (getFresh).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params;
  return forward(req, `/commission/rates/${encodeURIComponent(staffId)}`);
}
