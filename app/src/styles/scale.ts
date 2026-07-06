/**
 * Responsive scaling via react-native-size-matters.
 * @see https://github.com/nirsky/react-native-size-matters
 *
 * - scale / getWidth — width-based
 * - verticalScale / getHeight — height-based
 * - moderateScale — moderate width-based (default factor 0.5)
 * - moderateVerticalScale — moderate height-based
 */
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
