import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TButton, TSheet, TText } from '@/components/common';
import { TMonthGrid, type DayRange } from '@/components/common/TMonthGrid';
import { useResponsive } from '@/hooks/useResponsive';
import { t } from '@/i18n';
import { formatDayRange } from '@/lib/commission';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Reports' custom dates: tap the first day, then the last — the app's twin of owner-web's two date
 * boxes. Nothing past the store's today (from the API), and at most a year, which the API also
 * enforces (366 days).
 */
export function DateRangeSheet({
  visible,
  onClose,
  todayKey,
  initial,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  todayKey: string;
  initial: DayRange;
  onApply: (from: string, to: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { centerStyle } = useResponsive(520);
  const s = useMemo(() => createStyles(theme, insets.bottom), [theme, insets.bottom]);

  return (
    <TSheet visible={visible} onClose={onClose} contentStyle={[s.sheet, centerStyle]}>
      <View style={s.handle} />
      <TText variant="h4" weight="semibold">
        {t.commission.datesTitle}
      </TText>
      <TText variant="bodySm" color="textMuted" style={s.hint}>
        {t.commission.datesHint}
      </TText>
      {/* Mounted per opening, so the picker always starts from the dates on screen. */}
      {visible ? <RangePicker todayKey={todayKey} initial={initial} onApply={onApply} /> : null}
    </TSheet>
  );
}

function RangePicker({
  todayKey,
  initial,
  onApply,
}: {
  todayKey: string;
  initial: DayRange;
  onApply: (from: string, to: string) => void;
}) {
  const [range, setRange] = useState<DayRange>(initial);
  // A single tapped day is a one-day range.
  const from = range.from;
  const to = range.to ?? range.from;

  return (
    <View style={styles.g3}>
      <TMonthGrid mode="range" value={range} onChange={setRange} todayKey={todayKey} maxKey={todayKey} />
      <TText variant="bodyMd" color="textStrong" weight="semibold" align="center">
        {from && to ? formatDayRange(from, to) : ' '}
      </TText>
      <TButton variant="primary" size="lg" fullWidth disabled={!from || !to} onPress={() => from && to && onApply(from, to)}>
        {t.commission.datesApply}
      </TButton>
    </View>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(26) + bottomInset,
      maxHeight: '90%',
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    hint: { marginTop: moderateScale(2), marginBottom: moderateScale(12) },
  });
