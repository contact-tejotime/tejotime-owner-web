/**
 * Responsive scaling via react-native-size-matters.
 * @see https://github.com/nirsky/react-native-size-matters
 *
 * - scale / getWidth — width-based
 * - verticalScale / getHeight — height-based
 * - moderateScale — moderate width-based (default factor 0.5)
 * - moderateVerticalScale — moderate height-based
 */
import { Dimensions } from 'react-native';
import {
  moderateScale,
  moderateVerticalScale,
  scale,
  verticalScale,
} from 'react-native-size-matters';

export { moderateScale, moderateVerticalScale, scale, verticalScale };

/** @deprecated Prefer `scale` from this module or `react-native-size-matters`. */
export const getWidth = scale;

/** @deprecated Prefer `verticalScale` from this module or `react-native-size-matters`. */
export const getHeight = verticalScale;

/**
 * react-native-size-matters' guideline base width (the design baseline). A
 * device exactly this wide renders values 1:1.
 */
const GUIDELINE_BASE_WIDTH = 350;

/**
 * Above this width we stop growing. Plain `moderateScale` keeps inflating on
 * tablets (a 768pt tablet ≈ 1.6× at factor 0.5), which makes text and controls
 * look oversized. Clamping the effective width lets phones scale normally while
 * tablets plateau — pair this with the centered max-width container so tablet
 * content stays a comfortable reading width.
 */
const MAX_SCALE_WIDTH = 480;

/**
 * Width-aware "responsive size" with a tablet cap. Use for the dimensions that
 * were previously left unscaled — font sizes, control heights and icon sizes —
 * so they shrink on small phones (down to 320px) and grow modestly on large
 * phones without ballooning on tablets.
 *
 * Portrait is locked (app.json), so window width is effectively static per
 * device; reading `Dimensions.get` here is safe and avoids threading width
 * through every StyleSheet factory.
 *
 * @param size   design value at the 350pt baseline
 * @param factor how strongly to scale (0 = fixed, 1 = linear). Default 0.5.
 */
export function rSize(size: number, factor = 0.5): number {
  const width = Math.min(Dimensions.get('window').width, MAX_SCALE_WIDTH);
  const ratio = width / GUIDELINE_BASE_WIDTH;
  return Math.round((size + (size * ratio - size) * factor) * 100) / 100;
}

/** Responsive font size — `rSize` tuned for typography. */
export const scaleFont = (size: number): number => rSize(size, 0.5);
