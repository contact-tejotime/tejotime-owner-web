import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/ui/Icon';
import { useTheme } from '@/theme/ThemeProvider';

export type TabId = 'dashboard' | 'queue' | 'appointments' | 'customers' | 'settings';

const NAV: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: 'Home', icon: 'layoutDashboard' },
  { id: 'queue', label: 'Queue', icon: 'users' },
  { id: 'appointments', label: 'Appts', icon: 'calendar' },
  { id: 'customers', label: 'Clients', icon: 'user' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function BottomNav({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const { colors, fontFamily, layout } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.borderSubtle,
        backgroundColor: colors.surfaceCard,
        height: layout.bottomNavHeight + insets.bottom,
        paddingBottom: insets.bottom + 6,
      }}>
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <Pressable
            key={n.id}
            onPress={() => setTab(n.id)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 }}>
            <Icon
              name={n.icon}
              size={22}
              strokeWidth={active ? 2.4 : 2}
              color={active ? colors.primary : colors.textSubtle}
            />
            <Text
              style={{
                fontFamily: active ? fontFamily.semibold : fontFamily.medium,
                fontSize: 10,
                color: active ? colors.primary : colors.textSubtle,
              }}>
              {n.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
