import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TSwitch, TText } from '@/components/common';
import { SettingsPageShell, TimeSelect } from '@/components/settings';
import { t } from '@/i18n';
import { DayHoursVM } from '@/lib/hours';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function WorkingHours() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createHoursStyles(theme), [theme]);
  const hours = store.business?.hours ?? [];

  const update = (dayOfWeek: number, fields: Partial<DayHoursVM>) =>
    store.saveHours(hours.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, ...fields } : h)));

  return (
    <SettingsPageShell title={t.hours.title}>
      <View style={s.card}>
        {hours.map((h, i) => (
          <View key={h.dayOfWeek} style={[s.row, i < hours.length - 1 && s.rowBorder]}>
            <View style={s.topLine}>
              <TText variant="bodyMd" color="textStrong" weight="semibold" style={styles.flex}>
                {h.day}
              </TText>
              <TSwitch checked={h.open} onChange={(open) => update(h.dayOfWeek, { open })} />
            </View>
            {h.open ? (
              <View style={s.times}>
                <TimeSelect style={styles.flex} value={h.from} onChange={(from) => update(h.dayOfWeek, { from })} />
                <TText variant="bodySm" color="textSubtle">
                  {t.hours.separator}
                </TText>
                <TimeSelect style={styles.flex} value={h.to} onChange={(to) => update(h.dayOfWeek, { to })} />
              </View>
            ) : (
              <TText variant="bodySm" color="textSubtle" weight="medium">
                {t.hours.closed}
              </TText>
            )}
          </View>
        ))}
      </View>
      <TText variant="caption" color="textSubtle" style={s.footnote}>
        {t.hours.note}
      </TText>
    </SettingsPageShell>
  );
}

const createHoursStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
      ...styles.mt1,
    },
    // Two lines, not one. On one line the row was switch + day + two pickers + a separator, which
    // came to ~325pt inside a ~327pt row on a 393pt-wide phone: there was no slack to widen the day
    // column with, so "Mon" and "Wed" — the two widest abbreviations — still clipped to "Mor" and
    // "W…" even after the names were shortened. Giving the times their own line drops the
    // horizontal constraint entirely, which is what lets the **full** day name come back, on any
    // width and at any system text size. The card grew ~160pt and there was ~220pt spare below it.
    row: {
      ...styles.ph4,
      paddingVertical: moderateScale(12),
      gap: moderateScale(10),
    },
    // Switch on the right, where a row toggle belongs on both platforms.
    topLine: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    times: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(8) },
    rowBorder: {
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    footnote: { ...styles.mt3, ...styles.mh1 },
  });
