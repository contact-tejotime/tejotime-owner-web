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
import { can, isOwnerRole } from '@/lib/permissions';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

const goTo = (page: SettingsPageId) => () => router.push(SETTINGS_ROUTES[page] as any);

function countLabel(one: string, many: string, count: number) {
  return count === 1 ? one : format(many, { count });
}

export default function Settings() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createSettingsStyles(theme), [theme]);
  const biz = store.business;
  const access = store.session?.permissions ?? null;
  const role = store.session?.role ?? null;
  const showBusiness =
    can(access, 'profile') || can(access, 'hours') || can(access, 'services') || can(access, 'staff');
  const showBookings = can(access, 'notifications') || can(access, 'profile');
  const storeLabel = biz?.name ?? t.common.brand;
  const signedInAs = store.session?.name?.trim() || businessProfile.username;

  const businessRows = [
    can(access, 'profile') ? 'profile' : null,
    isOwnerRole(role) ? 'appearance' : null,
    can(access, 'hours') ? 'hours' : null,
    can(access, 'services') ? 'services' : null,
    can(access, 'staff') ? 'staff' : null,
  ].filter(Boolean) as string[];
  const lastBusiness = businessRows[businessRows.length - 1];

  const bookingRows = [
    can(access, 'profile') ? 'qr' : null,
    can(access, 'notifications') ? 'notifications' : null,
  ].filter(Boolean) as string[];
  const lastBooking = bookingRows[bookingRows.length - 1];

  return (
    <>
      <THeader title={t.settings.title} subtitle={storeLabel} avatar avatarName={storeLabel} />
      <TScreenScroll>
        {showBusiness ? (
          <Section title={t.settings.groupBusiness} styles={s}>
            <View style={s.card}>
              {can(access, 'profile') ? (
                <TSettingsRow
                  icon="building"
                  label={t.settings.businessProfile}
                  sub={[biz?.name, biz?.area].filter(Boolean).join(' · ') || t.settings.businessProfileSub}
                  onPress={goTo('profile')}
                  showBorder={lastBusiness !== 'profile'}
                />
              ) : null}
              {isOwnerRole(role) ? (
                <TSettingsRow
                  icon="sparkles"
                  label={t.settings.appearance}
                  sub={t.settings.appearanceSub}
                  onPress={goTo('appearance')}
                  showBorder={lastBusiness !== 'appearance'}
                />
              ) : null}
              {can(access, 'hours') ? (
                <TSettingsRow
                  icon="clock"
                  label={t.settings.workingHours}
                  sub={hoursSummary(biz?.hours)}
                  onPress={goTo('hours')}
                  showBorder={lastBusiness !== 'hours'}
                />
              ) : null}
              {can(access, 'services') ? (
                <TSettingsRow
                  icon="scissors"
                  label={t.settings.servicesPricing}
                  sub={countLabel(
                    t.settings.servicesCountOne,
                    t.settings.servicesCount,
                    store.services.length,
                  )}
                  onPress={goTo('services')}
                  showBorder={lastBusiness !== 'services'}
                />
              ) : null}
              {can(access, 'staff') ? (
                <TSettingsRow
                  icon="users"
                  label={t.settings.staffSeats}
                  sub={countLabel(t.settings.seatsCountOne, t.settings.seatsCount, store.staff.length)}
                  onPress={goTo('staff')}
                  showBorder={lastBusiness !== 'staff'}
                />
              ) : null}
            </View>
          </Section>
        ) : null}

        {isOwnerRole(role) ? (
          <Section title={t.settings.groupTeam} styles={s}>
            <View style={s.card}>
              <TSettingsRow
                icon="users"
                label={t.settings.teamLogins}
                sub={t.settings.teamLoginsSub}
                onPress={goTo('team')}
                showBorder={false}
              />
            </View>
          </Section>
        ) : null}

        {showBookings ? (
          <Section title={t.settings.groupBookings} styles={s}>
            <View style={s.card}>
              {can(access, 'profile') ? (
                <TSettingsRow
                  icon="qrCode"
                  label={t.settings.bookingQr}
                  sub={t.settings.bookingQrSub}
                  onPress={store.openQr}
                  showBorder={lastBooking !== 'qr'}
                />
              ) : null}
              {can(access, 'notifications') ? (
                <TSettingsRow
                  icon="bell"
                  label={t.settings.notifications}
                  sub={notificationsSub}
                  onPress={goTo('notifications')}
                  showBorder={lastBooking !== 'notifications'}
                />
              ) : null}
            </View>
          </Section>
        ) : null}

        <Section title={t.settings.groupAccount} styles={s}>
          <View style={s.card}>
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
              icon="moon"
              label={t.settings.darkMode}
              sub={t.settings.darkModeSub}
              trailing={<TSwitch checked={theme.dark} onChange={theme.setDark} />}
              showBorder={false}
            />
          </View>
        </Section>

        <Pressable
          onPress={store.signOut}
          disabled={store.signOutLoading}
          style={({ pressed }) => [s.signOutCard, pressed && s.signOutPressed]}
        >
          {store.signOutLoading ? (
            <ActivityIndicator size="small" color={theme.colors.error} />
          ) : (
            <View style={s.signOutIcon}>
              <Icon name="logOut" size={18} color={theme.colors.error} />
            </View>
          )}
          <TText variant="bodyMd" color="error" weight="semibold">
            {t.settings.signOut}
          </TText>
        </Pressable>

        <TText variant="caption" color="textSubtle" align="center" style={s.footer}>
          {format(t.settings.footer, { version: appVersion, username: signedInAs })}
        </TText>
      </TScreenScroll>
    </>
  );
}

function Section({
  title,
  styles: s,
  children,
}: {
  title: string;
  styles: ReturnType<typeof createSettingsStyles>;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <TText variant="bodySm" color="textStrong" weight="bold" style={s.groupTitle}>
        {title}
      </TText>
      {children}
    </View>
  );
}

const createSettingsStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    // Title sits tight above its card; sections breathe more between each other.
    section: { marginBottom: moderateScale(22) },
    groupTitle: {
      letterSpacing: moderateScale(0.15),
      marginBottom: moderateScale(6),
      marginLeft: moderateScale(2),
    },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    signOutCard: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      backgroundColor: colors.errorSoft,
      borderRadius: moderateScale(radius.lg),
      paddingVertical: moderateScale(16),
      paddingHorizontal: moderateScale(16),
      marginTop: moderateScale(6),
      marginBottom: moderateScale(4),
    },
    signOutPressed: { opacity: 0.88 },
    signOutIcon: {
      ...styles.nonFlexCenter,
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceCard,
    },
    footer: { marginTop: moderateScale(12), marginBottom: moderateScale(12) },
  });
