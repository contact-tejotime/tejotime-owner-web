import React, { useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { CustomerCard } from '@/components/cards/CustomerCard';
import { DueCard } from '@/components/customers/DueCard';
import {
  TButton,
  TEmptyState,
  THeader,
  TKeyboardScreen,
  TScopeNotice,
  TSearchInput,
  TSectionTitle,
  TText,
} from '@/components/common';
import { TCustomerCardSkeleton } from '@/components/common/TSkeleton';
import { Badge } from '@/components/ui/Badge';
import { useTabContent } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { DUE_SECTIONS, dueCount, dueHiddenLabel } from '@/lib/due';
import { can } from '@/lib/permissions';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { Customer } from '@/data/sample';

/**
 * Narrowest a customer card stays readable at. Each card carries a name, a phone
 * number and three labelled metrics in a row; below this they start wrapping
 * mid-metric, so the grid drops back to one column rather than squeezing.
 */
const CUSTOMER_CARD_MIN_WIDTH = 320;

/** Enough rows to fill a phone screen; the real list replaces them in place. */
const SKELETON_ROWS = [0, 1, 2, 3, 4];

type CustomersView = 'all' | 'due';

export default function Customers() {
  const theme = useTheme();
  const { colors } = theme;
  const store = useAppState();
  const { columns, gridItemWidth } = useTabContent();
  const numColumns = columns(CUSTOMER_CARD_MIN_WIDTH, { gutter: 12, max: 2 });
  /**
   * "All" | "Due · N" — the Due view is the call list (docs/customer-due-list.md). All stays the
   * default, so the tab opens exactly as it always has.
   */
  const [view, setView] = useState<CustomersView>('all');
  const [showHidden, setShowHidden] = useState(false);
  const access = store.session?.permissions ?? null;
  const canBook = can(access, 'appointments', 'manage');
  const canLog = can(access, 'customers', 'manage');
  const due = store.due;
  const toCall = dueCount(due);

  const shown = store.customers;
  const { total } = store.customerMeta;
  /**
   * Every plan sees its whole customer book (2026-10-28, docs/customer-list-no-limit.md); the
   * server only cuts at its page size (the newest 100), and then this says so plainly. It used to
   * key on `lockedCount`, the free plan's cut, which is now always 0. Never say why or how to see
   * more: App Review rejected v1.0 (2) under guideline 2.1(b) for an "Upgrade to Premium" with no
   * In-App Purchase behind it (docs/mobile-no-in-app-purchases.md).
   */
  const subtitle =
    shown.length < total
      ? format(t.customers.latestShown, { shown: shown.length, total })
      : format(t.customers.total, { total });

  // Someone with no visits yet is a new customer, not a row of zeros: "0 · — · ₹0" read like
  // missing data. A VIP badge still wins, since VIP is something the owner set on purpose.
  const renderCustomer = ({ item: c }: { item: Customer }) => (
    <View style={numColumns > 1 ? { width: gridItemWidth(numColumns) } : undefined}>
      <CustomerCard
        name={c.name}
        phone={c.phone}
        tag={
          c.vip ? (
            <Badge tone="primary">{t.customers.vip}</Badge>
          ) : c.visits === 0 ? (
            <Badge tone="success">{t.customers.newCustomer}</Badge>
          ) : null
        }
        note={c.visits === 0 ? t.customers.noVisitsYet : undefined}
        onCall={c.phone ? () => void Linking.openURL(`tel:${c.phone}`) : undefined}
        callLabel={format(t.customers.call, { name: c.name })}
        meta={[
          { label: t.customers.visits, value: c.visits },
          { label: t.customers.lastVisit, value: c.last },
          { label: t.customers.spend, value: c.spend },
        ]}
      />
    </View>
  );

  const segmented = (
    // The same segmented control as Appointments' Today | Regulars.
    <View style={[s.segmented, { backgroundColor: colors.surfaceHover }]} accessibilityRole="tablist">
      {(['all', 'due'] as const).map((key) => {
        const active = view === key;
        const label =
          key === 'all' ? t.customers.viewAll : toCall ? format(t.customers.viewDueCount, { count: toCall }) : t.customers.viewDue;
        return (
          <Pressable
            key={key}
            onPress={() => setView(key)}
            style={[s.segmentedBtn, active && { backgroundColor: colors.surfaceCard }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}>
            <TText variant="bodySm" weight="bold" color={active ? 'textStrong' : 'textMuted'} numberOfLines={1}>
              {label}
            </TText>
          </Pressable>
        );
      })}
    </View>
  );

  const cell = numColumns > 1 ? { width: gridItemWidth(numColumns) } : undefined;

  if (view === 'due') {
    const visible = due?.data ?? [];
    const hidden = due?.hidden ?? [];
    return (
      <TKeyboardScreen isScrollView={false}>
        <THeader title={t.customers.title} subtitle={t.customers.due.title} />
        <View style={s.segmentedWrap}>{segmented}</View>
        <ScrollView
          contentContainerStyle={[styles.screenPadding, styles.pb6, visible.length + hidden.length === 0 && s.emptyGrow]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={store.refreshing}
              onRefresh={store.refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }>
          <TScopeNotice />
          {!store.dueLoaded ? (
            <View style={s.skeletonList}>
              {SKELETON_ROWS.slice(0, 3).map((k) => (
                <TCustomerCardSkeleton key={k} />
              ))}
            </View>
          ) : visible.length + hidden.length === 0 ? (
            <TEmptyState fill icon="calendar" title={t.customers.due.empty} hint={t.customers.due.emptyHint} />
          ) : (
            <>
              <TText variant="bodySm" color="textMuted" style={s.lead}>
                {t.customers.due.subtitle}
              </TText>
              {visible.length === 0 ? (
                <TText variant="bodyMd" color="textMuted" style={s.lead}>
                  {t.customers.due.empty}
                </TText>
              ) : null}
              {DUE_SECTIONS.map((section) => {
                const rows = visible.filter((c) => c.status === section.status);
                if (rows.length === 0 || !due) return null;
                return (
                  <View key={section.status}>
                    <TSectionTitle>{format('{title} · {count}', { title: section.title, count: rows.length })}</TSectionTitle>
                    <View style={numColumns > 1 ? s.grid : styles.g3}>
                      {rows.map((c) => (
                        <View key={c.customerId} style={cell}>
                          <DueCard
                            c={c}
                            today={due.today}
                            callBackRange={due.callBackRange}
                            canBook={canBook}
                            canLog={canLog}
                            onBook={(slotStart, staffId, serviceIds) =>
                              store.bookDueCustomer(c.customerId, { slotStart, staffId, serviceIds })
                            }
                            onLog={(body) => store.setDueFollowup(c.customerId, body)}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
              {hidden.length > 0 ? (
                <View style={[s.hidden, { borderTopColor: colors.borderSubtle }]}>
                  <Pressable
                    onPress={() => setShowHidden((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showHidden }}>
                    <TText variant="bodySm" color="textMuted" weight="semibold">
                      {format(t.customers.due.hidden, { count: hidden.length })}
                    </TText>
                  </Pressable>
                  {showHidden
                    ? hidden.map((c) => (
                        <View key={c.customerId} style={[s.hiddenRow, { borderColor: colors.borderSubtle }]}>
                          <View style={styles.flex}>
                            <TText variant="bodySm" color="textStrong" weight="semibold">
                              {c.name}
                            </TText>
                            <TText variant="caption" color="textMuted">
                              {dueHiddenLabel(c)}
                            </TText>
                          </View>
                          {canLog ? (
                            <TButton
                              variant="ghost"
                              size="sm"
                              textColor={colors.primary}
                              onPress={() => void store.undoDueFollowup(c.customerId)}>
                              {t.customers.due.undo}
                            </TButton>
                          ) : null}
                        </View>
                      ))
                    : null}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </TKeyboardScreen>
    );
  }

  return (
    <TKeyboardScreen isScrollView={false}>
      <THeader
        title={t.customers.title}
        subtitle={subtitle}
      />

      <View style={s.segmentedWrap}>{segmented}</View>

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
        // `flexGrow` only while the list is empty, so the empty state can fill the screen and sit
        // in its middle rather than hugging the top under the search bar.
        contentContainerStyle={[styles.screenPadding, styles.pb6, styles.g3, shown.length === 0 && s.emptyGrow]}
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
            <TEmptyState
              fill
              icon={store.search ? 'search' : 'users'}
              title={store.search ? t.customers.noMatch : t.customers.empty}
            />
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
  segmentedWrap: { ...styles.screenPadding, ...styles.pb2 },
  segmented: {
    ...styles.flexRow,
    borderRadius: moderateScale(10),
    padding: moderateScale(4),
    gap: moderateScale(4),
  },
  segmentedBtn: {
    ...styles.flex,
    ...styles.itemsCenter,
    ...styles.justifyCenter,
    height: moderateScale(36),
    borderRadius: moderateScale(7),
    paddingHorizontal: moderateScale(4),
  },
  // `rowGap` only, never `gap`: the cells are sized in percent (see gridItemWidth).
  grid: { ...styles.flexRow, ...styles.wrap, ...styles.justifyBetween, rowGap: moderateScale(12) },
  lead: { marginTop: moderateScale(4) },
  hidden: {
    marginTop: moderateScale(20),
    paddingTop: moderateScale(12),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: moderateScale(8),
  },
  hiddenRow: {
    ...styles.flexRow,
    ...styles.itemsCenter,
    gap: moderateScale(8),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: moderateScale(10),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(8),
  },
  skeletonList: { ...styles.g3, ...styles.pt2 },
  // `space-between`, not `gap`: the cells are sized in percent (see
  // gridItemWidth), and an absolute column gap on top of that overflows the
  // row and collapses the grid back to one column. The list's own `g3`
  // supplies the vertical rhythm between rows.
  gridRow: { ...styles.justifyBetween },
  emptyGrow: { flexGrow: 1 },
});
