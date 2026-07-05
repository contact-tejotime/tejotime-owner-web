import { StyleSheet, ViewStyle } from 'react-native';

import { space } from '@/theme/tokens';

import { moderateScale } from './scale';

const SPACE_KEYS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

type GapStyles = Record<string, ViewStyle>;

const gap: GapStyles = {};

for (const key of SPACE_KEYS) {
  gap[`g${key}`] = { gap: moderateScale(space[key]) };
}

export default StyleSheet.create(gap);
