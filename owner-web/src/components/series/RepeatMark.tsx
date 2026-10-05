import "@/styles/series.css";

import { t } from "@/i18n";

import { Icon } from "@/components/Icon";

/**
 * The repeat icon on a series visit (Appointments rows, the Calendar's day list). An icon, not the
 * 🔁 emoji, which every platform draws differently. The svg itself is aria-hidden (Icon), so the
 * wrapper carries the name for screen readers and the tooltip for a mouse.
 *
 * Render it INSIDE the name's element, after the text, as the app does (a 14px primary glyph after
 * the name). It used to be a 20px disc beside the name in the row's wrapping flex line — and with
 * "Add to queue" beside it a phone row's body is ~119px, so even "Priya Regular" (96px) lost that
 * fight and the disc took a line of its own, making every series row a line taller than a one-off
 * (measured at 390px in headless Chrome, 2026-10-03). As a trailing glyph it fits beside a short
 * name. A name that already fills its line still pushes the glyph to the next one — the same rule
 * the MR / Patient badge follows. (A U+2060 word joiner before it was tried to keep it with the last
 * word; Chrome still breaks before an inline-flex box, so it was dropped.)
 *
 * No hooks and no "use client": it renders inside Server Component rows and the Calendar's client
 * day sheet alike.
 */
export function RepeatMark() {
  return (
    <span className="srs-repeat" role="img" aria-label={t.series.repeating} title={t.series.repeating}>
      <Icon name="repeat" size={14} strokeWidth={2.4} />
    </span>
  );
}
