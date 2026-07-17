import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { formatPhone } from '@/lib/phone';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

type Meta = { label: string; value: string | number };

function CustomerCardComponent({
  name,
  phone,
  meta = [],
  tag,
  onPress,
}: {
  name: string;
  phone?: string;
  meta?: Meta[];
  tag?: React.ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createCustomerCardStyles(theme), [theme]);

  return (
    <Pressable onPress={onPress} style={s.card}>
      <View style={s.row}>
        <InitialsAvatar name={name} size={48} />
        <View style={s.body}>
          <TText variant="bodyMd" color="textStrong" weight="semibold">
            {name}
          </TText>
          {phone && (
            <TText variant="bodySm" color="textMuted" style={s.phone}>
              {formatPhone(phone)}
            </TText>
          )}
        </View>
        {tag}
      </View>
      {meta.length > 0 && (
        <View style={s.metaRow}>
          {meta.map((m, i) => (
            <View key={i}>
              <TText variant="bodyMd" color="textStrong" weight="bold">
                {m.value}
              </TText>
              <TText variant="bodySm" color="textMuted" style={s.metaLabel}>
                {m.label}
              </TText>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/** Memoized so unchanged rows skip re-render during list/store updates. */
export const CustomerCard = React.memo(CustomerCardComponent);

const createCustomerCardStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.p4,
      ...shadow.xs,
    },
    row: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    body: { ...styles.flex, ...styles.minWidth0 },
    phone: { ...styles.mt1 },
    metaRow: {
      ...styles.flexRow,
      ...styles.g5,
      ...styles.mt4,
      ...styles.pt3,
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
    },
    metaLabel: { ...styles.mt1 },
  });
