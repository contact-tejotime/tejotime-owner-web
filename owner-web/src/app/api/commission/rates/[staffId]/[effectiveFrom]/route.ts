import { NextRequest } from "next/server";
import { forward } from "@/lib/proxy-route";

/** Remove a rate that has not started yet (or today's). 409 COMMISSION_RATE_LOCKED for a past day. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ staffId: string; effectiveFrom: string }> },
) {
  const { staffId, effectiveFrom } = await params;
  return forward(
    req,
    `/commission/rates/${encodeURIComponent(staffId)}/${encodeURIComponent(effectiveFrom)}`,
    { method: "DELETE" },
  );
}
