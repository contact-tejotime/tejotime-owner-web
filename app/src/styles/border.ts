import { StyleSheet, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

import { moderateScale } from './scale';

type BorderStyles = Record<string, ViewStyle>;

export function useBorder(): BorderStyles {
  const { colors } = useTheme();
  const borderColor = colors.borderDefault;

  return StyleSheet.create({
    b1: { borderWidth: moderateScale(1), borderColor },
    b2: { borderWidth: moderateScale(2), borderColor },
    bt1: { borderTopWidth: moderateScale(1), borderColor },
    bb1: { borderBottomWidth: moderateScale(1), borderColor },
    bl1: { borderLeftWidth: moderateScale(1), borderColor },
    br1: { borderRightWidth: moderateScale(1), borderColor },
    b1R8: { borderWidth: moderateScale(1), borderColor, borderRadius: moderateScale(8) },
    b1R12: { borderWidth: moderateScale(1), borderColor, borderRadius: moderateScale(radius.lg) },
    b1R16: { borderWidth: moderateScale(1), borderColor, borderRadius: moderateScale(radius.xl) },
    borderSubtle: { borderWidth: moderateScale(1), borderColor: colors.borderSubtle },
    borderFocus: { borderWidth: moderateScale(1), borderColor: colors.borderFocus },
  });
}
