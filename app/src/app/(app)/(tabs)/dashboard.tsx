import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { TButton, TScopeNotice } from '@/components/common';
import { HomeHeader } from '@/components/home/HomeHeader';
import { LiveQueueCard } from '@/components/home/LiveQueueCard';
import { QueueBoard } from '@/components/queue/QueueBoard';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { can } from '@/lib/permissions';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

/**
 * Home: a greeting header, then one scroll of the live-queue card (the three numbers an owner acts
 * on, plus Add walk-in) and the seat boards. Today's bookings live on the Appointments tab. A
 * summary card for them sat here briefly and was taken out at the owner's request, to keep Home
 * about the queue.
 *
 * Every block follows the permission map: a login without the queue gets no live card or boards,
 * and one without the profile gets no booking QR. A login with neither still gets the header and a
 * bare page rather than an error.
 */
export default function Dashboard() {
  const { colors } = useTheme();
  const store = useAppState();
  const access = store.session?.permissions ?? null;
  const showQueue = can(access, 'queue');
  const showQr = can(access, 'profile');

  const summary = (
    <View style={s.summary}>
      <TScopeNotice />
      {showQueue ? (
        <LiveQueueCard
          seats={store.seats}
          loading={store.bootstrapping}
          onAddWalkIn={store.openWalkin}
          onQr={showQr ? store.openQr : undefined}
        />
      ) : showQr ? (
        // No queue access, so no live card to carry the QR shortcut. Keep it reachable on its own.
        <TButton
          variant="outline"
          fullWidth
          onPress={store.openQr}
          leadingIcon={<Icon name="qrCode" size={18} color={colors.textStrong} />}>
          {t.dashboard.showQr}
        </TButton>
      ) : null}
    </View>
  );

  return (
    <>
      <HomeHeader
        name={store.business?.name ?? t.common.brand}
        logoUrl={store.business?.logoUrl || undefined}
        onBell={store.openAlerts}
      />
      {showQueue ? (
        <QueueBoard header={summary} />
      ) : (
        <ScrollView contentContainerStyle={s.bareScroll} showsVerticalScrollIndicator={false}>
          {summary}
        </ScrollView>
      )}
    </>
  );
}

const s = StyleSheet.create({
  summary: { gap: moderateScale(12) },
  bareScroll: { ...styles.screenPadding, ...styles.pt2, ...styles.pb6 },
});
