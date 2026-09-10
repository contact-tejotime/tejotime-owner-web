import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export function TSafeAreaScreen({
  children,
  style,
  // `left`/`right` are 0 in portrait but non-zero in landscape on notched
  // phones and on tablets with a rotated home indicator, which tablets now
  // reach. Including them by default keeps content clear of both.
  edges = ['top', 'bottom', 'left', 'right'],
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.surfacePage }, style]} edges={edges}>
      <View style={[styles.flex, styles.ph5]}>{children}</View>
    </SafeAreaView>
  );
}
