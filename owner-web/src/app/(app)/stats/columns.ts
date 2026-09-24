import type { CSSProperties } from "react";

/**
 * How many columns a desktop row of `count` equal cards should use, at most `max`: the count that
 * leaves the fewest empty slots on the last row, preferring more columns on a tie. Three cards go
 * three across, four go 2×2 (or four across when there is room), five go three over two.
 *
 * Never fewer than two, so a single card keeps a half-width slot (as the app's tablet grid keeps
 * a lone card at half width) instead of stretching across a monitor.
 *
 * Its own module, not a helper inside ReportQueuePreview: a function exported from a
 * "use client" file is only a client reference to the server page, and cannot be called there.
 */
export function balancedColumns(count: number, max: number): number {
  let best = 2;
  let bestEmpty = Number.POSITIVE_INFINITY;
  for (let cols = 2; cols <= max; cols++) {
    const empty = (cols - (count % cols)) % cols;
    if (empty <= bestEmpty) {
      best = cols;
      bestEmpty = empty;
    }
  }
  return best;
}

/**
 * The two column counts reports.css reads for a card grid: three at most from 1280px (about
 * 300px a card beside the sidebar), four at most from 1600px.
 */
export function gridColumnVars(count: number): CSSProperties {
  return {
    "--rp-grid-lg": balancedColumns(count, 3),
    "--rp-grid-xl": balancedColumns(count, 4),
  } as CSSProperties;
}
