import { format, t } from '@/i18n';
import { formatRate, type CommissionSegment } from '@/lib/commission';
import { formatMoney } from '@/lib/mappers';

/**
 * "₹4,000 × 20% = ₹800 · ₹6,000 × 30% = ₹1,800" — a period read rate by rate, so an owner can see
 * that a change of rate on the 16th paid the first fortnight at the old rate. The same wording as
 * owner-web's stats/commission-text.ts. Kept out of lib/commission.ts, which must stay import-free
 * for the drift check.
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
    .join(' · ');
}
