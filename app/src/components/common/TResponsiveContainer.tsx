import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { useResponsive } from '@/hooks/useResponsive';
import { styles } from '@/styles';

/**
 * Fills its parent on phones (no visual change). On tablets / large screens it
 * caps content to a comfortable centered column so cards and forms don't stretch
 * edge-to-edge.
 *
 * Non-destructive: the `maxWidth` + centering only kick in past the tablet
 * breakpoint (see {@link useResponsive}); below it the container is just
 * `flex: 1`, so phone layouts are unchanged.
 */
export function TResponsiveContainer({
  children,
  maxWidth = 640,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { centerStyle } = useResponsive(maxWidth);
  return <View style={[styles.flex, centerStyle, style]}>{children}</View>;
}
