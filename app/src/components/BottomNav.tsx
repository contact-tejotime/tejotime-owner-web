import { router, usePathname } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Icon, IconName } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { TAB_ROUTES, TabId, tabFromPathname } from '@/navigation/routes';
import { styles } from '@/styles';
import { moderateScale, scaleFont } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

const NAV: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: t.nav.home, icon: 'layoutDashboard' },
  { id: 'queue', label: t.nav.queue, icon: 'users' },
  { id: 'appointments', label: t.nav.appts, icon: 'calendar' },
  { id: 'customers', label: t.nav.clients, icon: 'user' },
  { id: 'settings', label: t.nav.settings, icon: 'settings' },
];

export function BottomNav() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tab = tabFromPathname(pathname);
  const s = useMemo(() => createBottomNavStyles(theme, insets.bottom), [theme, insets.bottom]);

  return (
    <View style={s.bar}>
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <Pressable key={n.id} onPress={() => router.push(TAB_ROUTES[n.id] as any)} style={s.item}>
            <Icon
              name={n.icon}
              size={22}
              strokeWidth={active ? 2.4 : 2}
              color={active ? theme.colors.primary : theme.colors.textSubtle}
            />
            <TText variant="caption" weight={active ? 'semibold' : 'medium'} style={bottomNavLabelStyle(s, active) as TextStyle}>
              {n.label}
            </TText>
          </Pressable>
        );
      })}
    </View>
  );
}

const createBottomNavStyles = (
  { colors, layout }: ThemeStyleProps & { layout: typeof import('@/theme/tokens').layout },
  bottomInset: number,
) =>
  StyleSheet.create({
    bar: {
      ...styles.flexRow,
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.surfaceCard,
      height: layout.bottomNavHeight + bottomInset,
      paddingBottom: bottomInset + moderateScale(6),
    },
    item: { ...styles.flex, ...styles.itemsCenter, ...styles.justifyCenter, ...styles.g1, ...styles.pt2 },
    label: { fontSize: scaleFont(10) },
    labelActive: { color: colors.primary },
    labelIdle: { color: colors.textSubtle },
  });

const bottomNavLabelStyle = (s: ReturnType<typeof createBottomNavStyles>, active: boolean): TextStyle =>
  active ? { ...s.label, ...s.labelActive } : { ...s.label, ...s.labelIdle };
