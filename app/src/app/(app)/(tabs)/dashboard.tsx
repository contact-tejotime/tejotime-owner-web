import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { StatCard } from '@/components/cards/StatCard';
import { TButton, THeader, TScreenScroll, TSectionTitle } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { TAB_ROUTES } from '@/navigation/routes';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

export default function Dashboard() {
  const { colors } = useTheme();
  const store = useAppState();

  const queuePreview = flatCards(store.seats).slice(0, 3);
  const d = store.dashboard;

  const kpis = [
    { key: 'appts', label: "Today's appts", value: d ? String(d.todaysAppointments) : '—', delta: undefined },
    { key: 'active', label: 'Active', value: d ? String(d.activeNow) : '—', delta: undefined },
    { key: 'checkin', label: 'Check in', value: d ? String(d.checkInCount) : '—', delta: undefined },
    { key: 'revenue', label: "Today's revenue", value: d ? formatMoney(d.revenue) : '—', delta: undefined },
  ];

  return (
    <>
      <THeader
        avatar
        title="Sharp Cuts"
        subtitle="Andheri West · Open till 9 PM"
        action={
          <IconButton variant="soft" accessibilityLabel="Notifications" onPress={store.openAlerts}>
            <Icon name="bell" size={20} color={colors.textBody} />
          </IconButton>
        }
      />
      <TScreenScroll>
        <TSectionTitle>Quick actions</TSectionTitle>
        <View style={dashboardStyles.actions}>
          <View style={dashboardStyles.actionCell}>
            <TButton
              variant="primary"
              fullWidth
              onPress={store.openWalkin}
              leadingIcon={<Icon name="plus" size={18} color="#fff" />}>
              Add walk-in
            </TButton>
          </View>
          <View style={dashboardStyles.actionCell}>
            <TButton
              variant="outline"
              fullWidth
              onPress={store.openQr}
              leadingIcon={<Icon name="qrCode" size={18} color={colors.textStrong} />}>
              Show QR
            </TButton>
          </View>
        </View>

        <TSectionTitle
          action={
            <TButton variant="ghost" size="sm" onPress={() => router.push(TAB_ROUTES.queue as any)} textColor={colors.primary}>
              View all
            </TButton>
          }>
          Active queue
        </TSectionTitle>
        <View style={dashboardStyles.queueList}>
          {queuePreview.map((c) => (
            <QueueCard key={c.id} card={c} onPress={() => store.openDetail(c.id)} />
          ))}
        </View>

        <TSectionTitle>Today&apos;s summary</TSectionTitle>
        <View style={dashboardStyles.kpiGrid}>
          {kpis.map((k) => (
            <View key={k.key} style={dashboardStyles.kpiCell}>
              <StatCard label={k.label} value={k.value} delta={k.delta} />
            </View>
          ))}
        </View>
      </TScreenScroll>
    </>
  );
}

const dashboardStyles = StyleSheet.create({
  actions: { ...styles.flexRow, ...styles.g3 },
  actionCell: { ...styles.flex },
  queueList: { ...styles.g2 },
  kpiGrid: { ...styles.flexRow, ...styles.wrap, ...styles.g3 },
  kpiCell: { width: '47.8%', flexGrow: 1 },
});
