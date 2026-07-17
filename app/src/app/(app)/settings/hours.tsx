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
            <TSwitch checked={h.open} onChange={(open) => update(h.dayOfWeek, { open })} />
            <TText variant="bodyMd" color="textStrong" weight="medium" style={styles.flex} numberOfLines={1}>
              {h.day}
            </TText>
            {h.open ? (
              <>
                <TimeSelect value={h.from} onChange={(from) => update(h.dayOfWeek, { from })} />
                <TText variant="bodySm" color="textSubtle">
                  {t.hours.separator}
                </TText>
                <TimeSelect value={h.to} onChange={(to) => update(h.dayOfWeek, { to })} />
              </>
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
    row: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      ...styles.ph4,
      paddingVertical: moderateScale(11),
    },
    rowBorder: {
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    footnote: { ...styles.mt3, ...styles.mh1 },
  });
