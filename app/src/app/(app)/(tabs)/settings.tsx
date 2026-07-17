import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { THeader, TScreenScroll, TSettingsRow, TSwitch, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { t, format } from '@/i18n';
import { appVersion, businessProfile, notificationsSub, subscription } from '@/data/settings';
import { hoursSummary } from '@/lib/hours';
import { SETTINGS_ROUTES, SettingsPageId } from '@/navigation/routes';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

const goTo = (page: SettingsPageId) => () => router.push(SETTINGS_ROUTES[page] as any);

export default function Settings() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createSettingsStyles(theme), [theme]);
  const biz = store.business;
  const bookingUrl = biz?.slug ? `tejotime.com/${biz.slug}` : businessProfile.bookingUrl;

  return (
    <>
      <THeader title={t.settings.title} subtitle={biz?.name ?? t.common.brand} avatar />
      <TScreenScroll>
        <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
          {t.settings.groupBusiness}
        </TText>
        <View style={s.card}>
          <TSettingsRow
            icon="building"
            label={t.settings.businessProfile}
            sub={[biz?.name, biz?.area].filter(Boolean).join(' · ') || t.settings.businessProfileSub}
            onPress={goTo('profile')}
          />
          <TSettingsRow icon="clock" label={t.settings.workingHours} sub={hoursSummary(biz?.hours)} onPress={goTo('hours')} />
          <TSettingsRow
            icon="scissors"
            label={t.settings.servicesPricing}
            sub={format(t.settings.servicesCount, { count: store.services.length })}
            onPress={goTo('services')}
          />
          <TSettingsRow
            icon="users"
            label={t.settings.staffSeats}
            sub={format(t.settings.seatsCount, { count: store.staff.length })}
            onPress={goTo('staff')}
            showBorder={false}
          />
        </View>

        <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
          {t.settings.groupBookings}
        </TText>
        <View style={s.card}>
          <TSettingsRow icon="qrCode" label={t.settings.bookingQr} sub={bookingUrl} onPress={store.openQr} />
          <TSettingsRow
            icon="bell"
            label={t.settings.notifications}
            sub={notificationsSub}
            onPress={goTo('notifications')}
            showBorder={false}
          />
        </View>

        <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
          {t.settings.groupAccount}
        </TText>
        <View style={s.card}>
          <TSettingsRow
            icon="creditCard"
            label={t.settings.subscription}
            sub={subscription.listSub}
            onPress={goTo('subscription')}
            trailing={
              <>
                <Badge tone="primary" size="sm">
                  {subscription.badge}
                </Badge>
                <Icon name="chevronRight" size={18} color={theme.colors.textSubtle} />
              </>
            }
          />
          <TSettingsRow
            icon="settings"
            label={t.settings.darkMode}
            sub={t.settings.darkModeSub}
            trailing={<TSwitch checked={theme.dark} onChange={theme.setDark} />}
            showBorder={false}
          />
        </View>

        <Pressable onPress={store.signOut} disabled={store.signOutLoading} style={s.signOutCard}>
          {store.signOutLoading ? (
            <ActivityIndicator size="small" color={theme.colors.error} />
          ) : (
            <Icon name="logOut" size={18} color={theme.colors.error} />
          )}
          <TText variant="bodyMd" color="error" weight="semibold">
            {t.settings.signOut}
          </TText>
        </Pressable>

        <TText variant="caption" color="textSubtle" align="center" style={s.footer}>
          {format(t.settings.footer, { version: appVersion, username: businessProfile.username })}
        </TText>
      </TScreenScroll>
    </>
  );
}

const createSettingsStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    groupTitle: {
      textTransform: 'uppercase',
      letterSpacing: moderateScale(0.5),
      marginTop: moderateScale(16),
      marginBottom: moderateScale(9),
      ...styles.mh1,
    },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    signOutCard: {
      ...styles.flexRow,
      ...styles.rowCenter,
      ...styles.g2,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(14),
      marginTop: moderateScale(20),
    },
    footer: { marginTop: moderateScale(14) },
  });
