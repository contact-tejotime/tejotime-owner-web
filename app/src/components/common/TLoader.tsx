import React from 'react';
import { ActivityIndicator, StyleProp, View, ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

/** A load that finishes inside this never shows a spinner at all, so fast screens don't flicker. */
const SPINNER_DELAY_MS = 250;

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
      <Animated.View entering={FadeIn.delay(SPINNER_DELAY_MS).duration(250)}>
        <ActivityIndicator size="large" color={colors.primary} />
      </Animated.View>
    </View>
  );
}
