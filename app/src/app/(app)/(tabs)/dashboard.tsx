import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, THeader, TScopeNotice, TSectionTitle } from '@/components/common';
import { QueueBoard } from '@/components/queue/QueueBoard';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/i18n';
import { can } from '@/lib/permissions';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

export default function Dashboard() {
  const { colors } = useTheme();
  const store = useAppState();
  const showQueue = can(store.session?.permissions ?? null, 'queue');
  const showQr = can(store.session?.permissions ?? null, 'profile');

  const waiting = useMemo(
    () => store.seats.reduce((n, g) => n + g.waitN, 0),
    [store.seats],
  );
  const seatCount = store.seats.length;

  return (
    <>
      <THeader
        avatar
        avatarName={store.business?.name ?? t.common.brand}
        title={store.business?.name ?? t.common.brand}
        subtitle={showQueue ? `${waiting} waiting · ${seatCount} seats` : undefined}
        action={
          <IconButton variant="soft" accessibilityLabel={t.dashboard.notifications} onPress={store.openAlerts}>
            <Icon name="bell" size={20} color={colors.textBody} />
          </IconButton>
        }
      />
      <View style={dashboardStyles.top}>
        <TScopeNotice />
        <TSectionTitle>{t.dashboard.quickActions}</TSectionTitle>
        <View style={dashboardStyles.actions}>
          {showQueue ? (
            <View style={dashboardStyles.actionCell}>
              <TButton
                variant="primary"
                fullWidth
                onPress={store.openWalkin}
                leadingIcon={<Icon name="plus" size={18} color="#fff" />}>
                {t.dashboard.addWalkIn}
              </TButton>
            </View>
          ) : null}
          {showQr ? (
            <View style={dashboardStyles.actionCell}>
              <TButton
                variant="outline"
                fullWidth
                onPress={store.openQr}
                leadingIcon={<Icon name="qrCode" size={18} color={colors.textStrong} />}>
                {t.dashboard.showQr}
              </TButton>
            </View>
          ) : null}
        </View>
      </View>
      {showQueue ? (
        <>
          <View style={dashboardStyles.queueTitle}>
            <TSectionTitle>{t.queue.title}</TSectionTitle>
          </View>
          <QueueBoard />
        </>
      ) : null}
    </>
  );
}

const dashboardStyles = StyleSheet.create({
  top: { ...styles.screenPadding, ...styles.pb2 },
  actions: { ...styles.flexRow, ...styles.g3 },
  actionCell: { ...styles.flex },
  queueTitle: { ...styles.screenPadding, ...styles.pt1 },
});
