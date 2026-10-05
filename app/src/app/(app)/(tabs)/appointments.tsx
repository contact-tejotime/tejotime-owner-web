import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppointmentListItem } from '@/components/appointments/AppointmentListItem';
import { NeedsAttentionCard } from '@/components/appointments/NeedsAttentionCard';
import { RegularCard } from '@/components/appointments/RegularCard';
import {
  TAppointmentRowSkeleton,
  TCustomerCardSkeleton,
  TEmptyState,
  THeader,
  TScopeNotice,
  TScreenScroll,
  TSectionTitle,
  TText,
} from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { useTabContent } from '@/hooks/useResponsive';
import { t } from '@/i18n';
import { IconButton } from '@/components/ui/IconButton';
import { can } from '@/lib/permissions';
import { dayKeyToLocalDate, storeTodayKey } from '@/lib/zoned';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

/** An appointment row carries a time, a customer, a service and a Check in button. */
const APPOINTMENT_MIN_WIDTH = 340;
/** A regular's card: a name with up to two badges, then three short lines. */
const REGULAR_MIN_WIDTH = 320;

/** Placeholder rows during the first load, in place of a false "No appointments today". */
const SKELETON_ROWS = [0, 1, 2];

type AppointmentsView = 'today' | 'regulars';

export default function Appointments() {
  const theme = useTheme();
  const { colors } = theme;
  const store = useAppState();
  const { columns, gridItemWidth } = useTabContent();
  const apptColumns = columns(APPOINTMENT_MIN_WIDTH, { gutter: 8, max: 2 });
  const regularColumns = columns(REGULAR_MIN_WIDTH, { gutter: 8, max: 2 });
  const canManage = can(store.session?.permissions ?? null, 'appointments', 'manage');
  /**
   * Regulars sit here rather than on Customers: the free plan cuts the customer list to two, and
   * that cut must not hide anyone's repeating booking (docs/recurring-appointments.md §14).
   */
  const [view, setView] = useState<AppointmentsView>('today');
  /** Loaded and nothing booked: the centred empty state replaces the list and fills the tab. */
  const isEmpty = !store.bootstrapping && store.appts.length === 0;
  const regularsEmpty = store.seriesLoaded && store.series.length === 0;

  // Was the literal string "Thursday, 24 June" — it never changed with the date. Locale-
  // formatted like the calendar's month label, so it needs no dictionary entry.
  // The STORE's today — the list below is the store's day (GET /appointments), so a phone in
  // another timezone must not head it with its own date. Locale-formatted for the phone's language.
  // Not memoised: the store's zone can arrive after the first render, and this is one format call.
  const todayLabel = dayKeyToLocalDate(storeTodayKey()).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    store.staff.forEach((st) => (map[st.id] = st.name));
    return map;
  }, [store.staff]);

  const cell = (n: number) => (n > 1 ? { width: gridItemWidth(n) } : undefined);

  return (
    <>
      <THeader
        title={t.appointments.title}
        subtitle={todayLabel}
        action={
          <IconButton variant="soft" accessibilityLabel={t.appointments.add} onPress={store.openWalkin}>
            <Icon name="plus" size={20} color={theme.colors.textBody} />
          </IconButton>
        }
      />
      <TScreenScroll
        refreshing={store.refreshing}
        onRefresh={store.refresh}
        grow={view === 'today' ? isEmpty : regularsEmpty}>
        <TScopeNotice />

        {/* The same segmented control as Reports' period switch. */}
        <View style={[apptStyles.segmented, { backgroundColor: colors.surfaceHover }]} accessibilityRole="tablist">
          {(['today', 'regulars'] as const).map((key) => {
            const active = view === key;
            return (
              <Pressable
                key={key}
                onPress={() => setView(key)}
                style={[apptStyles.segmentedBtn, active && { backgroundColor: colors.surfaceCard }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}>
                <TText variant="bodySm" weight="bold" color={active ? 'textStrong' : 'textMuted'} numberOfLines={1}>
                  {key === 'today' ? t.appointments.tabToday : t.appointments.tabRegulars}
                </TText>
              </Pressable>
            );
          })}
        </View>

        {view === 'today' ? (
          <>
            {store.seriesIssues.length > 0 ? (
              <NeedsAttentionCard
                issues={store.seriesIssues}
                canManage={canManage}
                onResolve={store.resolveSeriesIssue}
                onBook={store.bookSeriesIssue}
                onOpenSeries={store.openSeries}
              />
            ) : null}
            <TSectionTitle>{t.appointments.upcomingToday}</TSectionTitle>
            {isEmpty ? (
              <TEmptyState fill icon="calendar" title={t.appointments.empty} hint={t.appointments.emptyHint} />
            ) : (
              <View style={apptColumns > 1 ? apptStyles.grid : styles.g2}>
                {store.bootstrapping && store.appts.length === 0 ? (
                  SKELETON_ROWS.map((k) => (
                    <View key={k} style={cell(apptColumns)}>
                      <TAppointmentRowSkeleton />
                    </View>
                  ))
                ) : (
                  store.appts.map((a) => (
                    <View key={a.id} style={cell(apptColumns)}>
                      <AppointmentListItem
                        appointment={a}
                        staffName={a.staffId ? staffById[a.staffId] : undefined}
                        checkInLoading={store.checkInId === a.id}
                        onCheckIn={store.checkInAppt}
                        canManage={canManage}
                        actionBusy={store.apptAction?.id === a.id ? store.apptAction.kind : null}
                        onAction={store.actOnAppt}
                        onOpenSeries={store.openSeries}
                      />
                    </View>
                  ))
                )}
              </View>
            )}
          </>
        ) : regularsEmpty ? (
          <TEmptyState fill icon="repeat" title={t.series.emptyTitle} hint={t.series.emptyHint} />
        ) : (
          <View style={[regularColumns > 1 ? apptStyles.grid : styles.g2, apptStyles.regulars]}>
            {!store.seriesLoaded
              ? SKELETON_ROWS.map((k) => (
                  <View key={k} style={cell(regularColumns)}>
                    <TCustomerCardSkeleton />
                  </View>
                ))
              : store.series.map((sr) => (
                  <View key={sr.id} style={cell(regularColumns)}>
                    <RegularCard series={sr} onPress={store.openSeries} />
                  </View>
                ))}
          </View>
        )}
      </TScreenScroll>
    </>
  );
}

const apptStyles = StyleSheet.create({
  // `rowGap` only, never `gap`: the rows are sized in percent, and an absolute
  // column gap on top of that overflows and collapses the grid to one column.
  grid: {
    ...styles.flexRow,
    ...styles.wrap,
    ...styles.justifyBetween,
    rowGap: moderateScale(8),
  },
  segmented: {
    ...styles.flexRow,
    borderRadius: moderateScale(10),
    padding: moderateScale(4),
    gap: moderateScale(4),
    marginTop: moderateScale(4),
  },
  segmentedBtn: {
    ...styles.flex,
    ...styles.itemsCenter,
    ...styles.justifyCenter,
    height: moderateScale(36),
    borderRadius: moderateScale(7),
    paddingHorizontal: moderateScale(4),
  },
  regulars: { marginTop: moderateScale(14) },
});
