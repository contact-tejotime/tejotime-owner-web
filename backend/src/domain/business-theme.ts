/**
 * Appearance columns for a business row, shared by the admin panel and the owner portal.
 *
 * Extracted from admin.service so both writers produce the same pair of columns. Two copies of
 * this would drift, and the failure mode is bad: `theme` wins over `theme_color` at render
 * time, so a writer that updated only one of them would leave a store whose microsite disagreed
 * with the colour its own settings screen displayed.
 */

/**
 * Microsite theme config as stored in `business.theme` (jsonb).
 *
 * The id unions are mirrored from the frontend theme engine rather than imported: the backend
 * is Docker-built with `COPY . .` from backend/, so frontend/ is not in its build context.
 * Every field is optional — the engine fills gaps from the preset's own defaults.
 */
export interface ThemeConfigInput {
  preset?: 'minimal' | 'luxury' | 'modern' | 'bold' | 'medical' | 'warm';
  mode?: 'light' | 'dark' | 'auto';
  /** `#RRGGBB` brand seed. Dual-written to the legacy `theme_color` column. */
  brand?: string;
  radius?: 'sharp' | 'medium' | 'rounded';
  shadow?: 'none' | 'soft' | 'premium';
  density?: 'comfortable' | 'compact';
  animation?: 'subtle' | 'normal' | 'rich';
  heroVariant?: string;
  /** Optional `#RRGGBB` override of the preset accent strategy. */
  accent?: string;
  /** Primary / on-brand label ink. Absent or `auto` → engine picks for WCAG AA. */
  brandInk?: 'auto' | 'white' | 'dark';
}

/**
 * Theme columns, write-if-present.
 *
 * Spread conditionally (same guarded pattern as currency / is_active): a payload that omits
 * `themeColor` or `theme` must PRESERVE what is stored, never null it out.
 *
 * `theme.brand` and `theme_color` are dual-written IN BOTH DIRECTIONS, which is the whole point
 * of this function. `theme` wins over `theme_color` at render time, so the two drifting apart
 * has a specific and silent failure mode: the settings screen shows the new colour, the
 * microsite keeps rendering the old one, and nothing reports an error.
 *
 * That is reachable whenever a caller sends only the legacy `themeColor` — the admin panel
 * never does (its Appearance panel keeps the pair in lockstep) but the owner portal's API
 * accepts it, so the brand is merged back into the STORED theme object below.
 *
 * `stored` is the row's current appearance (updates only). Without its brand, a partial save
 * carrying a theme object but no brand at all would persist a BRANDLESS theme jsonb and drop
 * the store to the engine's default blue.
 */
export function themeColumns(
  input: { themeColor?: string; theme?: ThemeConfigInput },
  stored?: { themeColor?: string | null; theme?: unknown } | string | null,
): Record<string, unknown> {
  // Callers used to pass the stored brand as a bare string; both forms are accepted.
  const storedTheme =
    stored && typeof stored === 'object' && stored.theme && typeof stored.theme === 'object'
      ? (stored.theme as ThemeConfigInput)
      : undefined;
  const storedBrand = typeof stored === 'string' ? stored : stored?.themeColor ?? undefined;

  const out: Record<string, unknown> = {};
  // A brand hex inside the theme object wins; otherwise the legacy field, then the stored one.
  const brand = (input.theme?.brand ?? input.themeColor ?? storedBrand ?? undefined)?.toUpperCase();

  if (brand !== undefined) out.theme_color = brand;

  if (input.theme !== undefined) {
    out.theme = JSON.stringify(brand !== undefined ? { ...input.theme, brand } : input.theme);
  } else if (brand !== undefined && storedTheme && storedTheme.brand !== brand) {
    // Only the legacy field was sent. Rewrite the stored config's brand so the jsonb — which
    // is what actually renders — agrees with it.
    out.theme = JSON.stringify({ ...storedTheme, brand });
  }

  return out;
}
