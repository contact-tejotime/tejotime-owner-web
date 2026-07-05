import React, { useMemo } from 'react';
import { Pressable, StyleSheet, TextStyle, View } from 'react-native';

import { TText } from '@/components/common';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export type TabItem = { id: string; label: string; badge?: number };

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createTabsStyles(theme), [theme]);

  return (
    <View style={s.root}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => onChange?.(it.id)} style={tabsTabStyle(s, active)}>
            <TText weight="semibold" style={tabsLabelStyle(s, active) as TextStyle}>
              {it.label}
            </TText>
            {it.badge != null && (
              <View style={tabsBadgeStyle(s, active)}>
                <TText weight="semibold" style={tabsBadgeTextStyle(s, active) as TextStyle}>
                  {it.badge}
                </TText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const createTabsStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    root: {
      ...styles.flexRow,
      gap: moderateScale(20),
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    tab: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      ...styles.pb3,
      borderBottomWidth: moderateScale(2),
      marginBottom: -1,
      borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: colors.primary },
    label: { fontSize: moderateScale(15) },
    labelActive: { color: colors.textStrong },
    labelIdle: { color: colors.textMuted },
    badge: {
      borderRadius: moderateScale(radius.pill),
      paddingHorizontal: moderateScale(7),
      paddingVertical: moderateScale(3),
      backgroundColor: colors.surfaceSunken,
    },
    badgeActive: { backgroundColor: colors.primarySoft },
    badgeText: { fontSize: moderateScale(11), color: colors.textMuted },
    badgeTextActive: { color: colors.primarySoftFg },
  });

const tabsLabelStyle = (s: ReturnType<typeof createTabsStyles>, active: boolean): TextStyle =>
  active ? { ...s.label, ...s.labelActive } : { ...s.label, ...s.labelIdle };

const tabsBadgeStyle = (s: ReturnType<typeof createTabsStyles>, active: boolean) =>
  [s.badge, active ? s.badgeActive : null];

const tabsBadgeTextStyle = (s: ReturnType<typeof createTabsStyles>, active: boolean): TextStyle =>
  active ? { ...s.badgeText, ...s.badgeTextActive } : s.badgeText;

const tabsTabStyle = (s: ReturnType<typeof createTabsStyles>, active: boolean) =>
  [s.tab, active ? s.tabActive : null];
