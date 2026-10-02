import { t, format } from "@/i18n";
import { formatRate } from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import type { CommissionSegment } from "@/lib/server-api";

/**
 * "₹4,000 × 20% = ₹800 · ₹6,000 × 30% = ₹1,800" — a period read rate by rate, so an owner can see
 * that a change of rate on the 16th paid the first fortnight at the old rate. No "use client": the
 * Reports page (server) and the visits sheet (client) both use it.
 */
export function segmentBreakdown(segments: CommissionSegment[]): string {
  return segments
    .map((seg) =>
      seg.rateBp == null
        ? format(t.stats.breakdownNoRate, { revenue: formatMoney(seg.revenue) })
        : format(t.stats.breakdownItem, {
            revenue: formatMoney(seg.revenue),
            rate: formatRate(seg.rateBp),
            commission: formatMoney(seg.commission),
          }),
    )
    .join(" · ");
}
