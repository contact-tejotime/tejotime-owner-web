import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import type { SeriesDTO } from '@/lib/api';
import { rhythmLabel, statusLabel, stylistLabel, visitWhen } from '@/lib/series';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * One regular on the Appointments tab's Regulars list: who, how often, with whom, and when next.
 * Lives under Appointments rather than Customers on purpose — the free plan cuts the customer list
 * to two, and that cut must not hide anyone's repeating booking (docs/recurring-appointments.md §14).
 */
function RegularCardComponent({ series, onPress }: { series: SeriesDTO; onPress: (id: string) => void }) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const { colors } = theme;

  return (
    <Pressable
      onPress={() => onPress(series.id)}
      accessibilityRole="button"
      accessibilityLabel={format(t.series.openSeries, { name: series.customerName })}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: colors.surfaceHover }]}>
      <View style={s.top}>
        <TText variant="bodyMd" color="textStrong" weight="semibold" numberOfLines={1} style={s.name}>
          {series.customerName}
        </TText>
        {series.openIssues > 0 ? (
          <Badge tone="warning" dot size="sm">
            {t.series.needsAttention}
          </Badge>
        ) : null}
        {series.status !== 'active' ? (
          <Badge tone={series.status === 'paused' ? 'warning' : 'neutral'} size="sm">
            {statusLabel(series.status)}
          </Badge>
        ) : null}
      </View>
      <View style={s.rhythm}>
        <Icon name="repeat" size={14} color={colors.primary} />
        <TText variant="bodySm" color="textBody" weight="semibold" style={s.flex1}>
          {rhythmLabel(series)}
        </TText>
      </View>
      <TText variant="caption" color="textMuted" style={s.line}>
        {stylistLabel(series)}
      </TText>
      <TText variant="caption" color={series.nextVisitAt ? 'textBody' : 'textMuted'} style={s.line}>
        {series.nextVisitAt ? format(t.series.next, { when: visitWhen(series.nextVisitAt) }) : t.series.noNextVisit}
      </TText>
    </Pressable>
  );
}

/** Memoized so a socket-driven re-read that changed nothing does not redraw every card. */
export const RegularCard = React.memo(RegularCardComponent);

const createStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderLeftWidth: moderateScale(3),
      borderLeftColor: colors.primary,
      borderRadius: moderateScale(radius.md),
      ...styles.pv3,
      ...styles.ph4,
      ...shadow.xs,
    },
    top: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(6) },
    name: { ...styles.flex, ...styles.minWidth0 },
    rhythm: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(6), marginTop: moderateScale(6) },
    flex1: { ...styles.flex, ...styles.minWidth0 },
    line: { marginTop: moderateScale(3) },
  });
