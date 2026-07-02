import React from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  const { colors, radius, space, fontFamily, fontSize, shadow } = useTheme();
  const up = (delta || '').trim().startsWith('+');
  const deltaColor = up ? colors.success : colors.error;

  return (
    <View
      style={[
        {
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
          borderRadius: radius.lg,
          padding: space[4],
        },
        shadow.xs,
      ]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}>
        <Text style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textMuted }}>
          {label}
        </Text>
        {delta != null && (
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: deltaColor }}>
            {delta}
          </Text>
        )}
      </View>
      <Text
        style={{
          fontFamily: fontFamily.extrabold,
          fontSize: fontSize.h3,
          color: colors.textStrong,
          letterSpacing: -0.6,
          marginTop: 28,
        }}>
        {value}
      </Text>
    </View>
  );
}
