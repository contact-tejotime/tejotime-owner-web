import commonStyle from './commonStyle';
import flex from './flex';
import gap from './gap';
import margin from './margin';
import padding from './padding';

export {
  getHeight,
  getWidth,
  moderateScale,
  moderateVerticalScale,
  scale,
  verticalScale,
} from './scale';
export type { ThemeStyleProps } from './types';

export const styles: Record<string, object> = {
  ...flex,
  ...margin,
  ...padding,
  ...gap,
  ...commonStyle,
};

export { useBorder } from './border';
export { getTextVariantStyle } from './typography';
