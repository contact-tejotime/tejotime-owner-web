import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { THeader, TScreenScroll, TSettingsRow, TSwitch, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { t, format } from '@/i18n';
import { appVersion, businessProfile, notificationsSub, subscription } from '@/data/settings';
import { WEB_BASE_URL } from '@/lib/config';
import { hoursSummary } from '@/lib/hours';
import { SETTINGS_ROUTES, SettingsPageId } from '@/navigation/routes';
import { can, isOwnerRole } from '@/lib/permissions';
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
  // Every row is gated on the permission map from /auth/me. Rows are absent rather than
  // disabled: a greyed-out "Subscription" is an invitation to ask why it is greyed out.
  const access = store.session?.permissions ?? null;
  const role = store.session?.role ?? null;
  const showBusiness =
    can(access, 'profile') || can(access, 'hours') || can(access, 'services') || can(access, 'staff');
  const showBookings = can(access, 'notifications') || can(access, 'profile');
  // The microsite is keyed by phone, not slug — `tejotime.com/<slug>` has no route and 404s.
  // QR encodes /{phone}/card (chooser), not the microsite root or a raw .vcf.
  const phoneFull = `${biz?.countryCode ?? ''}${biz?.phoneNumber ?? ''}`;
  const cardUrl = phoneFull
    ? `${WEB_BASE_URL.replace(/^https?:\/\//, '')}/${phoneFull}/card`
    : businessProfile.bookingUrl;

  return (
    <>
      <THeader title={t.settings.title} subtitle={biz?.name ?? t.common.brand} avatar />
      <TScreenScroll>
        {showBusiness ? (
          <>
            <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
              {t.settings.groupBusiness}
            </TText>
            <View style={s.card}>
              {can(access, 'profile') ? (
                <TSettingsRow
                  icon="building"
                  label={t.settings.businessProfile}
                  sub={[biz?.name, biz?.area].filter(Boolean).join(' · ') || t.settings.businessProfileSub}
                  onPress={goTo('profile')}
                />
              ) : null}
              {can(access, 'hours') ? (
                <TSettingsRow
                  icon="clock"
                  label={t.settings.workingHours}
                  sub={hoursSummary(biz?.hours)}
                  onPress={goTo('hours')}
                />
              ) : null}
              {can(access, 'services') ? (
                <TSettingsRow
                  icon="scissors"
                  label={t.settings.servicesPricing}
                  sub={format(t.settings.servicesCount, { count: store.services.length })}
                  onPress={goTo('services')}
                />
              ) : null}
              {can(access, 'staff') ? (
                <TSettingsRow
                  icon="users"
                  label={t.settings.staffSeats}
                  sub={format(t.settings.seatsCount, { count: store.staff.length })}
                  onPress={goTo('staff')}
                  showBorder={false}
                />
              ) : null}
            </View>
          </>
        ) : null}

        {/* Tied to the ROLE, not a permission — mirroring the backend, where creating logins is
            the one thing an owner cannot delegate. */}
        {isOwnerRole(role) ? (
          <>
            <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
              {t.settings.groupTeam}
            </TText>
            <View style={s.card}>
              <TSettingsRow
                icon="users"
                label={t.settings.teamLogins}
                sub={t.settings.teamLoginsSub}
                onPress={goTo('team')}
                showBorder={false}
              />
            </View>
          </>
        ) : null}

        {showBookings ? (
          <>
            <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
              {t.settings.groupBookings}
            </TText>
            <View style={s.card}>
              {can(access, 'profile') ? (
                <TSettingsRow icon="qrCode" label={t.settings.bookingQr} sub={cardUrl} onPress={store.openQr} />
              ) : null}
              {can(access, 'notifications') ? (
                <TSettingsRow
                  icon="bell"
                  label={t.settings.notifications}
                  sub={notificationsSub}
                  onPress={goTo('notifications')}
                  showBorder={false}
                />
              ) : null}
            </View>
          </>
        ) : null}

        <TText variant="caption" color="textSubtle" weight="semibold" style={s.groupTitle}>
          {t.settings.groupAccount}
        </TText>
        <View style={s.card}>
          {/* Always present. Whatever else is hidden, everyone needs somewhere to change the
              password their owner handed them. */}
          <TSettingsRow
            icon="user"
            label={t.settings.yourAccount}
            sub={store.session?.name ?? t.settings.yourAccountSub}
            onPress={goTo('password')}
          />
          {can(access, 'billing') ? (
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
          ) : null}
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
