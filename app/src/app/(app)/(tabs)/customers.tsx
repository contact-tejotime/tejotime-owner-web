import { BlurView } from 'expo-blur';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { CustomerCard } from '@/components/cards/CustomerCard';
import { TButton, THeader, TScreenScroll, TSearchInput, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

export default function Customers() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createCustomersStyles({ ...theme, dark: theme.dark }), [theme]);
  const isPremium = store.plan === 'premium';

  const shown = store.customers;
  const lockedCount = store.customerMeta.lockedCount;
  const total = store.customerMeta.total;
  const subtitle = isPremium ? `${total} total` : `Free trial · latest ${shown.length} shown`;
  const placeholders = Array.from({ length: Math.min(lockedCount, 2) }, (_, i) => ({ id: `lock-${i}` }));

  return (
    <>
      <THeader
        title="Customers"
        subtitle={subtitle}
        action={isPremium ? <Badge tone="primary">Premium</Badge> : undefined}
      />

      <View style={s.searchWrap}>
        <TSearchInput value={store.search} onChangeText={store.setSearch} />
      </View>

      <TScreenScroll>
        <View style={s.list}>
          {shown.map((c) => (
            <CustomerCard
              key={c.id}
              name={c.name}
              phone={c.phone}
              tag={c.vip ? <Badge tone="primary">VIP</Badge> : null}
              meta={[
                { label: 'Visits', value: c.visits },
                { label: 'Last visit', value: c.last },
                { label: 'Spend', value: c.spend },
              ]}
            />
          ))}

          {lockedCount > 0 && (
            <View style={s.lockedWrap}>
              <View style={s.lockedPlaceholder} pointerEvents="none">
                {placeholders.map((c) => (
                  <CustomerCard
                    key={c.id}
                    name="••••••••"
                    phone="+91 ••••• •••••"
                    meta={[
                      { label: 'Visits', value: '•' },
                      { label: 'Last visit', value: '•' },
                      { label: 'Spend', value: '•' },
                    ]}
                  />
                ))}
              </View>

              {Platform.OS === 'ios' && (
                <BlurView intensity={40} tint={theme.dark ? 'dark' : 'light'} style={s.blurOverlay} />
              )}
              <View style={s.lockedOverlay}>
                <View style={s.lockedIcon}>
                  <Icon name="star" size={22} color={theme.colors.amber500} />
                </View>
                <TText variant="h5" color="textStrong" weight="bold" align="center">
                  {lockedCount} more clients locked
                </TText>
                <TText variant="bodySm" color="textMuted" align="center" style={s.lockedDesc}>
                  Your free trial shows your latest clients. Upgrade to Premium to see your full customer history,
                  spend & visits.
                </TText>
                <View style={s.upgradeWrap}>
                  <TButton
                    variant="primary"
                    onPress={store.upgrade}
                    leadingIcon={<Icon name="creditCard" size={20} color="#fff" />}>
                    Upgrade to Premium
                  </TButton>
                </View>
              </View>
            </View>
          )}
        </View>
      </TScreenScroll>
    </>
  );
}

const createCustomersStyles = ({ colors, radius, shadow, dark }: ThemeStyleProps & { dark: boolean }) =>
  StyleSheet.create({
    searchWrap: { ...styles.screenPadding, ...styles.pb2 },
    list: { ...styles.g3 },
    lockedWrap: { borderRadius: moderateScale(radius.lg), overflow: 'hidden', ...styles.mt1 },
    lockedPlaceholder: { ...styles.g3, opacity: 0.3 },
    blurOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    lockedOverlay: {
      ...styles.flexCenter,
      ...styles.g2,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      ...styles.p5,
      backgroundColor: dark ? 'rgba(11,18,32,0.55)' : 'rgba(248,250,252,0.5)',
    },
    lockedIcon: {
      ...styles.nonFlexCenter,
      width: moderateScale(48),
      height: moderateScale(48),
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.warningSoft,
      ...shadow.sm,
    },
    lockedDesc: { maxWidth: moderateScale(260) },
    upgradeWrap: { ...styles.mt1 },
  });
