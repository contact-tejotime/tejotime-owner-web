import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { StatCard } from '@/components/cards/StatCard';
import { TButton, THeader, TScopeNotice, TScreenScroll, TSectionTitle, TText } from '@/components/common';
import { t } from '@/i18n';
import { can } from '@/lib/permissions';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { TAB_ROUTES } from '@/navigation/routes';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

export default function Stats() {
  const { colors } = useTheme();
  const store = useAppState();
  const showQueue = can(store.session?.permissions ?? null, 'queue');

  const queuePreview = flatCards(store.seats).slice(0, 3);
  const d = store.dashboard;

  const kpis = [
    { key: 'appts', label: t.dashboard.kpiAppts, value: d ? String(d.todaysAppointments) : t.common.dash },
    {
      key: 'active',
      label: t.dashboard.kpiActive,
      value: d ? String(d.activeNow + d.waitingNow) : t.common.dash,
    },
    { key: 'checkin', label: t.dashboard.kpiCheckIn, value: d ? String(d.checkInCount) : t.common.dash },
    { key: 'revenue', label: t.dashboard.kpiRevenue, value: d ? formatMoney(d.revenue) : t.common.dash },
  ];

  return (
    <>
      <THeader title={t.stats.title} subtitle={t.stats.subtitle} />
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TScopeNotice />

        {showQueue ? (
          <>
            <TSectionTitle
              action={
                <TButton
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push(TAB_ROUTES.dashboard as any)}
                  textColor={colors.primary}>
                  {t.dashboard.viewAll}
                </TButton>
              }>
              {t.dashboard.activeQueue}
            </TSectionTitle>
            <View style={statsStyles.queueList}>
              {queuePreview.length === 0 ? (
                <TText variant="bodySm" color="textMuted">
                  {t.dashboard.emptyQueue}
                </TText>
              ) : (
                queuePreview.map((c) => <QueueCard key={c.id} card={c} onPress={() => store.openDetail(c.id)} />)
              )}
            </View>
          </>
        ) : null}

        <TSectionTitle>{t.dashboard.todaysSummary}</TSectionTitle>
        <View style={statsStyles.kpiGrid}>
          {kpis.map((k) => (
            <View key={k.key} style={statsStyles.kpiCell}>
              <StatCard label={k.label} value={k.value} />
            </View>
          ))}
        </View>
      </TScreenScroll>
    </>
  );
}

const statsStyles = StyleSheet.create({
  queueList: { ...styles.g2 },
  kpiGrid: { ...styles.flexRow, ...styles.wrap, ...styles.g3 },
  kpiCell: { width: '47.8%', flexGrow: 1 },
});
