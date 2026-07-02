import React from 'react';
import { View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { StatCard } from '@/components/cards/StatCard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { buildSeatGroups, flatCards } from '@/lib/queue';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

import { Header, ScreenScroll, SectionTitle } from './chrome';

export function Dashboard() {
  const { colors } = useTheme();
  const store = useAppState();

  const active = store.queue.filter((q) => q.status === 'waiting' || q.status === 'in-service');
  const groups = buildSeatGroups(store.queue, store.staff, store.services);
  const queuePreview = flatCards(groups).slice(0, 3);

  const kpis = [
    { key: 'appts', label: "Today's appts", value: String(store.appts.length + store.queue.length), delta: '+4' },
    { key: 'active', label: 'Active', value: String(active.length), delta: undefined },
    { key: 'checkin', label: 'Check in', value: String(store.queue.length), delta: undefined },
    { key: 'revenue', label: "Today's revenue", value: '₹18.4k', delta: '+12%' },
  ];

  return (
    <>
      <Header
        avatar
        title="Sharp Cuts"
        subtitle="Andheri West · Open till 9 PM"
        action={
          <IconButton variant="soft" accessibilityLabel="Notifications" onPress={store.openAlerts}>
            <Icon name="bell" size={20} color={colors.textBody} />
          </IconButton>
        }
      />
      <ScreenScroll>
        <SectionTitle>Quick actions</SectionTitle>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button
              variant="primary"
              fullWidth
              onPress={store.openWalkin}
              leadingIcon={<Icon name="plus" size={18} color="#fff" />}>
              Add walk-in
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="outline"
              fullWidth
              onPress={store.openQr}
              leadingIcon={<Icon name="qrCode" size={18} color={colors.textStrong} />}>
              Show QR
            </Button>
          </View>
        </View>

        <SectionTitle
          action={
            <Button variant="ghost" size="sm" onPress={() => store.setTab('queue')} textColor={colors.primary}>
              View all
            </Button>
          }>
          Active queue
        </SectionTitle>
        <View style={{ gap: 8 }}>
          {queuePreview.map((c) => {
            const entry = store.queue.find((q) => q.id === c.id);
            return <QueueCard key={c.id} card={c} onPress={() => entry && store.openDetail(entry)} />;
          })}
        </View>

        <SectionTitle>Today&apos;s summary</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {kpis.map((k) => (
            <View key={k.key} style={{ width: '47.8%', flexGrow: 1 }}>
              <StatCard label={k.label} value={k.value} delta={k.delta} />
            </View>
          ))}
        </View>
      </ScreenScroll>
    </>
  );
}
