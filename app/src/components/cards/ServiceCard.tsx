import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

function ServiceCardComponent({
  name,
  duration,
  price,
  description,
  color,
  selected = false,
  multiSelect = false,
  onPress,
}: {
  name: string;
  duration?: string;
  price?: string;
  description?: string;
  color?: string;
  selected?: boolean;
  /**
   * Show an explicit tick box. A visit can be several services, and a border colour alone does
   * not tell anyone that picking a second one is allowed — the box is the affordance.
   */
  multiSelect?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createServiceCardStyles(theme), [theme]);
  const accent = color ?? theme.colors.secondary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multiSelect ? 'checkbox' : 'button'}
      accessibilityState={{ checked: multiSelect ? selected : undefined, selected }}
      style={serviceCardStyle(s, selected)}>
      <View style={serviceAccentStyle(s.accent, accent)} />
      {multiSelect && (
        <View style={[s.tick, selected ? s.tickOn : null]}>
          {selected && <Icon name="check" size={13} color={theme.colors.surfaceCard} />}
        </View>
      )}
      <View style={s.body}>
        <TText variant="bodyMd" color="textStrong" weight="semibold">
          {name}
        </TText>
        {description && (
          <TText variant="bodySm" color="textMuted" style={s.description}>
            {description}
          </TText>
        )}
        {duration && (
          <View style={s.durationRow}>
            <Icon name="clock" size={14} color={theme.colors.textMuted} />
            <TText variant="bodySm" color="textMuted" weight="medium">
              {duration}
            </TText>
          </View>
        )}
      </View>
      {price != null && (
        <TText variant="h5" color="textStrong" weight="bold">
          {price}
        </TText>
      )}
    </Pressable>
  );
}

/** Memoized so unchanged service rows skip re-render. */
export const ServiceCard = React.memo(ServiceCardComponent);

const createServiceCardStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g4,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1.5),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.p4,
      ...shadow.xs,
    },
    cardSelected: {
      borderColor: colors.primary,
      ...shadow.sm,
    },
    accent: {
      width: moderateScale(4),
      alignSelf: 'stretch',
      borderRadius: moderateScale(radius.pill),
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    // Square, deliberately: a circle would read as "pick one of these".
    tick: {
      width: moderateScale(21),
      height: moderateScale(21),
      borderRadius: moderateScale(6),
      borderWidth: moderateScale(2),
      borderColor: colors.borderDefault,
      ...styles.itemsCenter,
      justifyContent: 'center',
    },
    tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    description: { ...styles.mt1 },
    durationRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(5), ...styles.mt2 },
  });

const serviceAccentStyle = (
  base: ReturnType<typeof createServiceCardStyles>['accent'],
  backgroundColor: string,
) => [base, { backgroundColor }];

const serviceCardStyle = (
  s: ReturnType<typeof createServiceCardStyles>,
  selected: boolean,
) => [s.card, selected ? s.cardSelected : null];
