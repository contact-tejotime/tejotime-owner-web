import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
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
  note,
  onPress,
  onCall,
  callLabel,
}: {
  name: string;
  phone?: string;
  meta?: Meta[];
  tag?: React.ReactNode;
  /** Shown instead of the metrics row, e.g. "No visits yet" where every metric would be zero. */
  note?: string;
  onPress?: () => void;
  /** Rings the customer. Omitted when there is no number to call. */
  onCall?: () => void;
  callLabel?: string;
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
        {onCall ? (
          <IconButton variant="soft" size="sm" onPress={onCall} accessibilityLabel={callLabel}>
            <Icon name="phone" size={16} color={theme.colors.primary} />
          </IconButton>
        ) : null}
      </View>
      {note ? (
        <View style={s.noteRow}>
          <TText variant="bodySm" color="textMuted">
            {note}
          </TText>
        </View>
      ) : meta.length > 0 ? (
        // Equal columns with hairline dividers: left-packed metrics left the right half of every
        // card empty, and the figures didn't line up from one card to the next.
        <View style={s.metaRow}>
          {meta.map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <View style={s.metaDivider} /> : null}
              <View style={s.metaCell}>
                <TText variant="bodyMd" color="textStrong" weight="bold" numberOfLines={1}>
                  {m.value}
                </TText>
                <TText variant="caption" color="textMuted" numberOfLines={1} style={s.metaLabel}>
                  {m.label}
                </TText>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}
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
      ...styles.itemsCenter,
      ...styles.mt4,
      paddingVertical: moderateScale(10),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceHover,
    },
    metaCell: { ...styles.flex, ...styles.itemsCenter, ...styles.minWidth0, paddingHorizontal: moderateScale(4) },
    metaDivider: { width: StyleSheet.hairlineWidth * 2, height: moderateScale(28), backgroundColor: colors.borderSubtle },
    metaLabel: { ...styles.mt1 },
    noteRow: {
      ...styles.mt4,
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceHover,
    },
  });
