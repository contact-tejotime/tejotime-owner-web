import { StyleSheet, ViewStyle } from 'react-native';

import { space } from '@/theme/tokens';

import { getHeight, moderateScale } from './scale';

const SPACE_KEYS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

type PaddingStyles = Record<string, ViewStyle>;

const padding: PaddingStyles = {};

for (const key of SPACE_KEYS) {
  const v = space[key];
  padding[`p${key}`] = { padding: moderateScale(v) };
  padding[`pt${key}`] = { paddingTop: getHeight(v) };
  padding[`pb${key}`] = { paddingBottom: getHeight(v) };
  padding[`pl${key}`] = { paddingLeft: moderateScale(v) };
  padding[`pr${key}`] = { paddingRight: moderateScale(v) };
  padding[`ph${key}`] = { paddingHorizontal: moderateScale(v) };
  padding[`pv${key}`] = { paddingVertical: getHeight(v) };
}

export default StyleSheet.create(padding);
