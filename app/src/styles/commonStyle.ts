import { StyleSheet, TextStyle, ViewStyle } from 'react-native';

import flex from './flex';
import padding from './padding';

type CommonStyles = Record<
  'mainContainer' | 'innerContainer' | 'textCenter' | 'screenPadding' | 'minWidth0',
  ViewStyle | TextStyle
>;

const commonStyle: CommonStyles = StyleSheet.create({
  mainContainer: { ...flex.flex },
  innerContainer: { ...padding.ph5, ...padding.pt6 },
  textCenter: { textAlign: 'center' },
  screenPadding: { ...padding.ph5 },
  minWidth0: { minWidth: 0 },
});

export default commonStyle;
