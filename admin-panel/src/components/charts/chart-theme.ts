/**
 * Shared chart constants. The two series hues are the brand pair from
 * globals.css (--blue-600, teal) — validated for CVD separation and ≥3:1
 * contrast on the white card surface. Text always wears ink tokens, never
 * the series color.
 */
export const SERIES_1 = "#2563eb"; // blue-600 — primary series
export const SERIES_2 = "#0d9488"; // teal — second slice only
export const GRID_INK = "#e2e8f0"; // gray-200
export const AXIS_INK = "#64748b"; // gray-500
export const CHART_HEIGHT = 260;

/** One style object so every Recharts tooltip looks like the panel's cards. */
export const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
  padding: "8px 10px",
} as const;
