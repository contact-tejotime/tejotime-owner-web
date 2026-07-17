import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TSwitch, TText } from '@/components/common';
import { SettingsPageShell } from '@/components/settings';
import { t } from '@/i18n';
import { NotificationPref, notificationPrefs } from '@/data/settings';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function Notifications() {
  const theme = useTheme();
  const s = useMemo(() => createNotificationsStyles(theme), [theme]);
  const [prefs, setPrefs] = useState<NotificationPref[]>(notificationPrefs);

  const togglePref = (id: string) => (enabled: boolean) =>
    setPrefs((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));

  return (
    <SettingsPageShell title={t.notifications.title}>
      <View style={s.card}>
        {prefs.map((p, i) => (
          <View key={p.id} style={[s.row, i < prefs.length - 1 && s.rowBorder]}>
            <View style={s.body}>
              <TText variant="bodyMd" color="textStrong" weight="medium">
                {p.label}
              </TText>
              <TText variant="caption" color="textMuted" style={s.sub}>
                {p.sub}
              </TText>
            </View>
            <TSwitch checked={p.enabled} onChange={togglePref(p.id)} />
          </View>
        ))}
      </View>
      <TText variant="caption" color="textSubtle" style={s.footnote}>
        {t.notifications.note}
      </TText>
    </SettingsPageShell>
  );
}

const createNotificationsStyles = ({ colors, radius }: ThemeStyleProps) =>
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
      ...styles.g3,
      ...styles.ph4,
      paddingVertical: moderateScale(13),
    },
    rowBorder: {
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    sub: { marginTop: moderateScale(3) },
    footnote: { ...styles.mt3, ...styles.mh1 },
  });
