import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { THeader, TScreenScroll, TSettingsRow, TSwitch } from '@/components/common';
import { IconName } from '@/components/ui/Icon';
import { business } from '@/data/sample';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

const ROWS: { icon: IconName; label: string; action: 'qr' | 'toast' }[] = [
  { icon: 'building', label: 'Business profile', action: 'toast' },
  { icon: 'clock', label: 'Working hours', action: 'toast' },
  { icon: 'scissors', label: 'Services & pricing', action: 'toast' },
  { icon: 'users', label: 'Staff & permissions', action: 'toast' },
  { icon: 'qrCode', label: 'Booking QR code', action: 'qr' },
  { icon: 'creditCard', label: 'Subscription · Professional', action: 'toast' },
];

export default function Settings() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createSettingsStyles(theme), [theme]);

  return (
    <>
      <THeader title="Settings" subtitle={business.name} avatar />
      <TScreenScroll>
        <View style={s.card}>
          {ROWS.map((r, i) => (
            <TSettingsRow
              key={r.label}
              icon={r.icon}
              label={r.label}
              onPress={r.action === 'qr' ? store.openQr : store.openAlerts}
              showBorder={i < ROWS.length - 1}
            />
          ))}
        </View>

        <View style={s.darkModeCard}>
          <TSwitch label="Dark mode" checked={theme.dark} onChange={theme.setDark} />
        </View>

        <View style={s.logoutCard}>
          <TSettingsRow
            icon="logOut"
            label="Log out"
            onPress={store.signOut}
            destructive
            showBorder={false}
          />
        </View>
      </TScreenScroll>
    </>
  );
}

const createSettingsStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
      ...styles.mt1,
    },
    darkModeCard: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.pv4,
      ...styles.ph4,
      marginTop: moderateScale(14),
    },
    logoutCard: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
      marginTop: moderateScale(14),
    },
  });
