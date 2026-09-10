import { BlurView } from 'expo-blur';
import React, { useMemo } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';

import { CustomerCard } from '@/components/cards/CustomerCard';
import { THeader, TKeyboardScreen, TSearchInput, TText } from '@/components/common';
import { TButton } from '@/components/common/TButton';
import { TLoader } from '@/components/common/TLoader';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useTabContent } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import type { Customer } from '@/data/sample';

/**
 * Narrowest a customer card stays readable at. Each card carries a name, a phone
 * number and three labelled metrics in a row; below this they start wrapping
 * mid-metric, so the grid drops back to one column rather than squeezing.
 */
const CUSTOMER_CARD_MIN_WIDTH = 320;

export default function Customers() {
  const theme = useTheme();
  const store = useAppState();
  const { columns, gridItemWidth } = useTabContent();
  const numColumns = columns(CUSTOMER_CARD_MIN_WIDTH, { gutter: 12, max: 2 });
  const s = useMemo(() => createCustomersStyles({ ...theme, dark: theme.dark }), [theme]);
  const isPremium = store.plan === 'premium';

  const shown = store.customers;
  const lockedCount = store.customerMeta.lockedCount;
  const total = store.customerMeta.total;
  const subtitle = isPremium
    ? format(t.customers.total, { total })
    : format(t.customers.trialShown, { shown: shown.length });
  const placeholders = useMemo(
    () => Array.from({ length: Math.min(lockedCount, 2) }, (_, i) => ({ id: `lock-${i}` })),
    [lockedCount],
  );

  const renderCustomer = ({ item: c }: { item: Customer }) => (
    <View style={numColumns > 1 ? { width: gridItemWidth(numColumns) } : undefined}>
      <CustomerCard
        name={c.name}
        phone={c.phone}
        tag={c.vip ? <Badge tone="primary">{t.customers.vip}</Badge> : null}
        meta={[
          { label: t.customers.visits, value: c.visits },
          { label: t.customers.lastVisit, value: c.last },
          { label: t.customers.spend, value: c.spend },
        ]}
      />
    </View>
  );

  const lockedFooter =
    lockedCount > 0 ? (
      <View style={s.lockedWrap}>
        <View style={s.lockedPlaceholder} pointerEvents="none">
          {placeholders.map((c) => (
            <CustomerCard
              key={c.id}
              name="••••••••"
              phone="+•• ••••• •••••"
              meta={[
                { label: t.customers.visits, value: '•' },
                { label: t.customers.lastVisit, value: '•' },
                { label: t.customers.spend, value: '•' },
              ]}
            />
          ))}
        </View>

        {Platform.OS === 'ios' && <BlurView intensity={40} tint={theme.dark ? 'dark' : 'light'} style={s.blurOverlay} />}
        <View style={s.lockedOverlay}>
          <View style={s.lockedIcon}>
            <Icon name="star" size={22} color={theme.colors.amber500} />
          </View>
          <TText variant="h5" color="textStrong" weight="bold" align="center">
            {format(t.customers.moreLocked, { count: lockedCount })}
          </TText>
          <TText variant="bodySm" color="textMuted" align="center" style={s.lockedDesc}>
            {t.customers.upsell}
          </TText>
          <View style={s.upgradeWrap}>
            <TButton
              variant="primary"
              loading={store.upgradeLoading}
              onPress={store.upgrade}
              leadingIcon={<Icon name="creditCard" size={20} color={theme.colors.textOnBrand} />}>
              {t.customers.upgrade}
            </TButton>
          </View>
        </View>
      </View>
    ) : null;

  return (
    <TKeyboardScreen isScrollView={false}>
      <THeader
        title={t.customers.title}
        subtitle={subtitle}
        action={isPremium ? <Badge tone="primary">{t.customers.premium}</Badge> : undefined}
      />

      <View style={s.searchWrap}>
        <TSearchInput value={store.search} onChangeText={store.setSearch} />
      </View>

      <FlatList
        // FlatList refuses to change `numColumns` in place, so the column count
        // has to be part of the identity: without this key, rotating a tablet
        // crashes with "Changing numColumns on the fly is not supported".
        key={`cols-${numColumns}`}
        data={shown}
        keyExtractor={(c) => c.id}
        renderItem={renderCustomer}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? s.gridRow : undefined}
        contentContainerStyle={[styles.screenPadding, styles.pb6, styles.g3]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          store.bootstrapping ? (
            <TLoader fullScreen={false} style={styles.pt6} />
          ) : (
            <TText variant="bodySm" color="textMuted" style={styles.pt4}>
              {store.search ? t.customers.noMatch : t.customers.empty}
            </TText>
          )
        }
        ListFooterComponent={lockedFooter}
        refreshControl={
          <RefreshControl
            refreshing={store.refreshing}
            onRefresh={store.refresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      />
    </TKeyboardScreen>
  );
}

const createCustomersStyles = ({ colors, radius, shadow, dark }: ThemeStyleProps & { dark: boolean }) =>
  StyleSheet.create({
    searchWrap: { ...styles.screenPadding, ...styles.pb2 },
    // `space-between`, not `gap`: the cells are sized in percent (see
    // gridItemWidth), and an absolute column gap on top of that overflows the
    // row and collapses the grid back to one column. The list's own `g3`
    // supplies the vertical rhythm between rows.
    gridRow: { ...styles.justifyBetween },
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
