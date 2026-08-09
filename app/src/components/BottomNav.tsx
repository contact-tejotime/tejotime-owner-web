import { router, usePathname } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Icon, IconName } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { can, type ModuleAccess, type PermissionModule } from '@/lib/permissions';
import { useAppState } from '@/state/store';
import { TAB_ROUTES, TabId, tabFromPathname } from '@/navigation/routes';
import { styles } from '@/styles';
import { moderateScale, scaleFont } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/** `module: null` means always shown — Settings is where you change your own password. */
const NAV: { id: TabId; label: string; icon: IconName; module: PermissionModule | null }[] = [
  { id: 'dashboard', label: t.nav.home, icon: 'layoutDashboard', module: 'dashboard' },
  { id: 'stats', label: t.nav.stats, icon: 'star', module: 'dashboard' },
  { id: 'appointments', label: t.nav.appts, icon: 'calendar', module: 'appointments' },
  { id: 'calendar', label: t.nav.calendar, icon: 'grid', module: 'calendar' },
  { id: 'customers', label: t.nav.clients, icon: 'user', module: 'customers' },
  { id: 'settings', label: t.nav.settings, icon: 'settings', module: null },
];

function navVisible(id: TabId, module: PermissionModule | null, access: ModuleAccess | null): boolean {
  if (module === null) return true;
  if (id === 'dashboard') return can(access, 'dashboard') || can(access, 'queue');
  if (id === 'stats') return can(access, 'dashboard');
  return can(access, module);
}

export function BottomNav() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tab = tabFromPathname(pathname);
  const { session } = useAppState();
  const s = useMemo(() => createBottomNavStyles(theme, insets.bottom), [theme, insets.bottom]);

  // Driven by the permission map from /auth/me — the same map the API guards enforce, so a tab
  // that is hidden here is also a request the server would refuse. Presentation only.
  const items = useMemo(
    () => NAV.filter((n) => navVisible(n.id, n.module, session?.permissions ?? null)),
    [session],
  );

  return (
    <View style={s.bar}>
      {items.map((n) => {
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
