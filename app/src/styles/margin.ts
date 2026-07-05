import { StyleSheet, ViewStyle } from 'react-native';

import { space } from '@/theme/tokens';

import { getHeight, moderateScale } from './scale';

const SPACE_KEYS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

type MarginStyles = Record<string, ViewStyle>;

const margin: MarginStyles = {};

for (const key of SPACE_KEYS) {
  const v = space[key];
  margin[`m${key}`] = { margin: moderateScale(v) };
  margin[`mt${key}`] = { marginTop: getHeight(v) };
  margin[`mb${key}`] = { marginBottom: getHeight(v) };
  margin[`ml${key}`] = { marginLeft: moderateScale(v) };
  margin[`mr${key}`] = { marginRight: moderateScale(v) };
  margin[`mh${key}`] = { marginHorizontal: moderateScale(v) };
  margin[`mv${key}`] = { marginVertical: getHeight(v) };
}

export default StyleSheet.create(margin);
