import React, { useMemo } from 'react';
import { StyleSheet, TextStyle, View } from 'react-native';

import { TText } from '@/components/common';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
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
  const theme = useTheme();
  const s = useMemo(() => createStatCardStyles(theme), [theme]);
  const up = (delta || '').trim().startsWith('+');

  return (
    <View style={s.card}>
      <View style={s.header}>
        <TText variant="bodySm" color="textMuted" weight="medium" style={s.label}>
          {label}
        </TText>
        {delta != null && (
          <TText variant="bodySm" weight="semibold" style={(up ? s.deltaUp : s.deltaDown) as TextStyle}>
            {delta}
          </TText>
        )}
      </View>
      <TText variant="h3" color="textStrong" weight="extrabold" style={s.value}>
        {value}
      </TText>
    </View>
  );
}

const createStatCardStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.p4,
      ...shadow.xs,
    },
    header: { ...styles.flexRow, ...styles.itemsStart, ...styles.justifyBetween, ...styles.g2 },
    label: { ...styles.flex },
    value: { letterSpacing: -0.6, marginTop: moderateScale(28) },
    deltaUp: { color: colors.success },
    deltaDown: { color: colors.error },
  });
