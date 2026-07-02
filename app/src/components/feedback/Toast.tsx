import React from 'react';
import { Text, View } from 'react-native';

import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export function Toast() {
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  const { toast } = useAppState();
  if (!toast) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 96, alignItems: 'center' }}>
      <View
        style={[
          {
            backgroundColor: colors.textStrong,
            borderRadius: radius.pill,
            paddingVertical: 12,
            paddingHorizontal: 18,
          },
          shadow.lg,
        ]}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.surfaceCard }}>
          {toast}
        </Text>
      </View>
    </View>
  );
}
