import React from 'react';
import { ActivityIndicator, StyleProp, View, ViewStyle } from 'react-native';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export function TLoader({
  fullScreen = true,
  style,
}: {
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        fullScreen ? [styles.flex, styles.flexCenter, { backgroundColor: colors.surfacePage }] : styles.flexCenter,
        style,
      ]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
