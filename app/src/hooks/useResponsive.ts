import { useWindowDimensions, ViewStyle } from 'react-native';

/** Width (dp) at/above which we treat the device as a tablet / large screen. */
export const TABLET_MIN_WIDTH = 768;

export type ResponsiveInfo = {
  width: number;
  height: number;
  isTablet: boolean;
  isLandscape: boolean;
  /** Max content width to center within on large screens; `undefined` on phones. */
  contentMaxWidth?: number;
  /**
   * Drop-in style that caps + centers content on tablets and is `null` on
   * phones. Spread into a style array, e.g. `style={[s.sheet, centerStyle]}`.
   */
  centerStyle: ViewStyle | null;
};

/**
 * Width / orientation awareness for responsive layouts. Reactive via
 * `useWindowDimensions`, so it updates if the window size ever changes.
 *
 * Phones report `contentMaxWidth: undefined` / `centerStyle: null` (no
 * constraint — layout unchanged); tablets report the capped column width so
 * content can be centered rather than stretched edge-to-edge.
 *
 * @param maxWidth content column width to cap to on tablets (default 640)
 */
export function useResponsive(maxWidth = 640): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const contentMaxWidth = isTablet ? maxWidth : undefined;
  return {
    width,
    height,
    isTablet,
    isLandscape: width > height,
    contentMaxWidth,
    centerStyle: contentMaxWidth
      ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
      : null,
  };
}
