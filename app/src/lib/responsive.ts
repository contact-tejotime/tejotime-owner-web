/**
 * Breakpoint / layout arithmetic for phones, foldables and tablets.
 *
 * Deliberately **pure**: no React, no `react-native`, no DOM. Everything here is
 * a function of numbers, so it can be exercised by the framework-free self-check
 * in `scripts/responsive-check.ts` without a simulator or a test runner. The
 * React binding lives in `@/hooks/useResponsive`.
 *
 * Sizes are in **dp** (React Native's density-independent points), which is the
 * same unit Android's `sw<N>dp` resource qualifiers use — so the numbers below
 * line up with the platform's own idea of "tablet".
 */

/**
 * Material 3 / Apple size classes, keyed on the *window* width.
 *
 * `medium` and `expanded` are not "tablet" synonyms: an iPad in Slide Over is
 * ~320dp (compact) and a large phone in landscape is ~850dp (expanded). Layout
 * decisions should key on the size class — how much room is there *right now* —
 * and only device-shape decisions (like whether rotation is allowed at all)
 * should key on {@link isTabletSize}.
 */
export type SizeClass = 'compact' | 'medium' | 'expanded';

/** Lower bound (dp, inclusive) of each size class. */
export const BREAKPOINTS = {
  /** Phones in portrait, and any window narrowed by split-screen. */
  compact: 0,
  /** Small tablets in portrait, large phones in landscape, half-screen iPad. */
  medium: 600,
  /** Tablets in landscape, iPad in portrait, desktop-class windows. */
  expanded: 840,
} as const;

/**
 * A device is a tablet when its **shorter** side is at least this wide, matching
 * Android's `sw600dp` qualifier.
 *
 * Testing the short side rather than the current width is what makes this
 * orientation-independent: a 7" Android tablet is 600×960dp and would fail a
 * naive `width >= 768` check in portrait, while a 6.7" phone in landscape is
 * 850dp wide and would wrongly pass it.
 */
export const TABLET_MIN_SHORT_SIDE = 600;

/**
 * True when the *device* is tablet-shaped, regardless of how it is being held
 * or how the window is currently sized.
 *
 * Use this for device-shape decisions (allowing rotation, showing a denser
 * chrome). For "do I have room for two columns", use {@link sizeClassFor} or
 * {@link columnsFor} against the live window width instead — a tablet in Slide
 * Over has a phone-sized window.
 */
export function isTabletSize(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
}

/** Size class for a window of the given width. */
export function sizeClassFor(width: number): SizeClass {
  if (width >= BREAKPOINTS.expanded) return 'expanded';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

/**
 * The width to cap a centered content column at, or `undefined` when the window
 * is already narrower than the cap and should be left full-bleed.
 *
 * Keying on `width > cap` rather than on "is this a tablet" is what keeps phone
 * portrait pixel-identical to the pre-tablet layout (every cap in the app is
 * wider than a phone) while still reining in a phone held in **landscape**,
 * where an uncapped form would stretch to 850dp of unreadable line length.
 */
export function contentMaxWidthFor(width: number, cap: number): number | undefined {
  return width > cap ? cap : undefined;
}

/**
 * How many equal columns of at least `minItemWidth` fit in `width`, given the
 * gutter between them.
 *
 * Returns at least 1 — a container narrower than one item still renders that
 * item rather than collapsing to zero columns.
 */
export function columnsFor(
  width: number,
  { minItemWidth, gutter = 0, max = Infinity }: { minItemWidth: number; gutter?: number; max?: number },
): number {
  if (!(width > 0) || !(minItemWidth > 0)) return 1;
  // n columns occupy n*item + (n-1)*gutter, so solve for n and floor it.
  const fit = Math.floor((width + gutter) / (minItemWidth + gutter));
  return Math.max(1, Math.min(max, fit));
}

/**
 * Share of the row, as a percentage, left between columns of a wrap grid.
 *
 * The gutter is expressed as part of the width rather than as a `gap` on the row
 * for a specific reason: `gap` is absolute pixels while the cells are
 * percentages, so `50% + 50% + gap` overflows the row by exactly the gap and
 * flex-wrap quietly pushes the second cell onto its own line — a two-column grid
 * that renders as a one-column list with no error anywhere. Rows using
 * {@link gridItemWidth} must therefore set `justifyContent: 'space-between'` and
 * a `rowGap` only, never a plain `gap`.
 */
const GRID_GUTTER_PERCENT = 3;

/**
 * Percentage width for one cell in an `n`-column flex-wrap grid, expressed as a
 * string React Native accepts.
 *
 * `n` cells always sum to strictly under 100%, so no amount of sub-pixel
 * rounding can overflow the row. See {@link GRID_GUTTER_PERCENT}.
 */
export function gridItemWidth(columns: number): `${number}%` {
  const n = Math.max(1, Math.floor(columns));
  if (n === 1) return '100%';
  const share = (100 - GRID_GUTTER_PERCENT * (n - 1)) / n;
  return `${Math.floor(share * 100) / 100}%`;
}

/**
 * Reading-column caps for tab content.
 *
 * Exported from here rather than living in the tabs layout because the screens
 * *inside* that layout need the same number: they are drawn into the capped
 * column, so it — not the window width — is the space their grids get to divide
 * up. Two copies of this constant would drift into a grid that computes columns
 * against a width it does not actually have.
 */
export const TAB_CONTENT_MAX_WIDTH = 720;
export const TAB_CONTENT_MAX_WIDTH_EXPANDED = 900;

/** The cap the tab shell applies at a given window width. */
export function tabContentCapFor(width: number): number {
  return sizeClassFor(width) === 'expanded'
    ? TAB_CONTENT_MAX_WIDTH_EXPANDED
    : TAB_CONTENT_MAX_WIDTH;
}
