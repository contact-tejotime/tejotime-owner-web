import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { CustomerCard } from '@/components/cards/CustomerCard';
import { THeader, TKeyboardScreen, TSearchInput, TText } from '@/components/common';
import { TCustomerCardSkeleton } from '@/components/common/TSkeleton';
import { Badge } from '@/components/ui/Badge';
import { useTabContent } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import type { Customer } from '@/data/sample';

/**
 * Narrowest a customer card stays readable at. Each card carries a name, a phone
 * number and three labelled metrics in a row; below this they start wrapping
 * mid-metric, so the grid drops back to one column rather than squeezing.
 */
const CUSTOMER_CARD_MIN_WIDTH = 320;

/** Enough rows to fill a phone screen; the real list replaces them in place. */
const SKELETON_ROWS = [0, 1, 2, 3, 4];

export default function Customers() {
  const theme = useTheme();
  const store = useAppState();
  const { columns, gridItemWidth } = useTabContent();
  const numColumns = columns(CUSTOMER_CARD_MIN_WIDTH, { gutter: 12, max: 2 });

  const shown = store.customers;
  const { total, lockedCount } = store.customerMeta;
  /**
   * A free store gets a truncated list from the server. Say so plainly, but never why or how to
   * lift it: App Review rejected v1.0 (2) under guideline 2.1(b) for an "Upgrade to Premium"
   * with no In-App Purchase behind it, and pointing at a purchase elsewhere is its own rejection.
   */
  const subtitle =
    lockedCount > 0
      ? format(t.customers.latestShown, { shown: shown.length, total })
      : format(t.customers.total, { total });

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

  return (
    <TKeyboardScreen isScrollView={false}>
      <THeader
        title={t.customers.title}
        subtitle={subtitle}
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
            // Skeleton rows rather than a spinner: the list's shape is known before the data
            // arrives, so showing it avoids the blank-then-pop that a centred spinner gives.
            <View style={s.skeletonList}>
              {SKELETON_ROWS.map((k) => (
                <TCustomerCardSkeleton key={k} />
              ))}
            </View>
          ) : (
            <TText variant="bodySm" color="textMuted" style={styles.pt4}>
              {store.search ? t.customers.noMatch : t.customers.empty}
            </TText>
          )
        }
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

const s = StyleSheet.create({
  searchWrap: { ...styles.screenPadding, ...styles.pb2 },
  skeletonList: { ...styles.g3, ...styles.pt2 },
  // `space-between`, not `gap`: the cells are sized in percent (see
  // gridItemWidth), and an absolute column gap on top of that overflows the
  // row and collapses the grid back to one column. The list's own `g3`
  // supplies the vertical rhythm between rows.
  gridRow: { ...styles.justifyBetween },
});
