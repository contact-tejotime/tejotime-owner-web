import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StoreMark } from '@/components/ui/StoreMark';
import { t } from '@/i18n';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

/** "Good morning" before noon, "Good afternoon" until five, "Good evening" after. */
function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return t.dashboard.greetingMorning;
  if (h < 17) return t.dashboard.greetingAfternoon;
  return t.dashboard.greetingEvening;
}

/**
 * Home's own header: the store's mark and name under a greeting and today's date, with
 * notifications on the right.
 *
 * Not `THeader`, which every other tab shares. Home's old subtitle ("0 waiting · 1 seats") repeated
 * what the live-queue card now shows in full, so the slot carries the day instead.
 */
export function HomeHeader({ name, logoUrl, onBell }: { name: string; logoUrl?: string; onBell: () => void }) {
  const { colors } = useTheme();
  // Re-derived on each render (the tab re-renders on every queue update), so a phone left open
  // across noon or midnight catches up on its own.
  const now = new Date();
  const dateLabel = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <View style={s.root}>
      <StoreMark name={name} logoUrl={logoUrl} />
      <View style={s.body}>
        <TText variant="caption" color="textMuted" weight="semibold" numberOfLines={1}>
          {`${greeting(now)} · ${dateLabel}`}
        </TText>
        <TText variant="h4" color="textStrong" weight="extrabold" numberOfLines={1} style={s.name}>
          {name}
        </TText>
      </View>
      <IconButton variant="soft" accessibilityLabel={t.dashboard.notifications} onPress={onBell}>
        <Icon name="bell" size={20} color={colors.textBody} />
      </IconButton>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    ...styles.flexRow,
    ...styles.itemsCenter,
    ...styles.g3,
    ...styles.ph5,
    paddingTop: moderateScale(14),
    paddingBottom: moderateScale(10),
  },
  body: { ...styles.flex, ...styles.minWidth0, gap: moderateScale(2) },
  name: { letterSpacing: -0.4 },
});
