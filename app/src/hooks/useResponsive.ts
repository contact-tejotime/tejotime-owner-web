import { useMemo } from 'react';
import { useWindowDimensions, ViewStyle } from 'react-native';

import {
  BREAKPOINTS,
  columnsFor,
  contentMaxWidthFor,
  gridItemWidth,
  isTabletSize,
  sizeClassFor,
  tabContentCapFor,
  TABLET_MIN_SHORT_SIDE,
  type SizeClass,
} from '@/lib/responsive';

export { BREAKPOINTS, TABLET_MIN_SHORT_SIDE };
export type { SizeClass };

/**
 * @deprecated Kept so older call sites keep compiling. Prefer `isTablet` (which
 * measures the device's short side, so it is orientation-independent) or
 * `sizeClass` (which measures the window you actually have to draw in).
 */
export const TABLET_MIN_WIDTH = 768;

export type ResponsiveInfo = {
  width: number;
  height: number;
  /** Device is tablet-shaped (short side >= 600dp) — true in both orientations. */
  isTablet: boolean;
  isLandscape: boolean;
  /** How much room this *window* has: `compact` | `medium` | `expanded`. */
  sizeClass: SizeClass;
  /** `sizeClass !== 'compact'` — enough room for two columns of most content. */
  isWide: boolean;
  /** The cap that was requested — unlike `contentMaxWidth`, always a number. */
  cap: number;
  /** Max content width to center within, or `undefined` when the window is already narrower. */
  contentMaxWidth?: number;
  /**
   * Drop-in style that caps + centers content once the window is wider than the
   * cap, and is `null` below it. Spread into a style array, e.g.
   * `style={[s.sheet, centerStyle]}`.
   */
  centerStyle: ViewStyle | null;
  /**
   * Columns of at least `minItemWidth` that fit the capped content column.
   * Pair with {@link ResponsiveInfo.gridItemWidth} to lay them out.
   */
  columns: (minItemWidth: number, opts?: { gutter?: number; max?: number }) => number;
  /** Percentage width for one cell of an `n`-column flex-wrap grid. */
  gridItemWidth: (columns: number) => `${number}%`;
};

/**
 * Width / orientation awareness for responsive layouts. Reactive via
 * `useWindowDimensions`, so it follows rotation on tablets and resizing in
 * iPad Split View / Android split-screen.
 *
 * Phones in portrait are unaffected: every `maxWidth` the app passes is wider
 * than a phone, so `contentMaxWidth` stays `undefined` and `centerStyle` stays
 * `null` there. The cap engages when the window genuinely gets wide — a tablet,
 * or a phone turned landscape.
 *
 * @param maxWidth content column width to cap to (default 640). A hard cap, not
 *   a target: a login card stays 440 wide on a 1366dp iPad.
 */
export function useResponsive(maxWidth = 640): ResponsiveInfo {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const contentMaxWidth = contentMaxWidthFor(width, maxWidth);
    const columnWidth = contentMaxWidth ?? width;
    return {
      width,
      height,
      isTablet: isTabletSize(width, height),
      isLandscape: width > height,
      sizeClass: sizeClassFor(width),
      isWide: sizeClassFor(width) !== 'compact',
      cap: maxWidth,
      contentMaxWidth,
      centerStyle: contentMaxWidth
        ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
        : null,
      // Measured against the capped column, not the raw window: content is
      // centered inside `contentMaxWidth`, so that is the space a grid has.
      columns: (minItemWidth, opts) => columnsFor(columnWidth, { minItemWidth, ...opts }),
      gridItemWidth,
    };
  }, [width, height, maxWidth]);
}

/**
 * `useResponsive` pre-tuned to the column the tab shell draws its screens into.
 *
 * Screens under `(app)/(tabs)` are wrapped in a capped, centered container, so
 * asking the raw window how many columns fit would overcount on a wide tablet.
 * This resolves the same cap the shell uses, so `columns()` divides up the space
 * the screen actually occupies.
 */
export function useTabContent(): ResponsiveInfo {
  const { width } = useWindowDimensions();
  return useResponsive(tabContentCapFor(width));
}
