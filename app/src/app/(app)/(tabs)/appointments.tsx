import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppointmentListItem } from '@/components/appointments/AppointmentListItem';
import {
  TAppointmentRowSkeleton,
  TEmptyState,
  THeader,
  TScopeNotice,
  TScreenScroll,
  TSectionTitle,
} from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { useTabContent } from '@/hooks/useResponsive';
import { t } from '@/i18n';
import { IconButton } from '@/components/ui/IconButton';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

/** An appointment row carries a time, a customer, a service and a Check in button. */
const APPOINTMENT_MIN_WIDTH = 340;

/** Placeholder rows during the first load, in place of a false "No appointments today". */
const SKELETON_ROWS = [0, 1, 2];

export default function Appointments() {
  const theme = useTheme();
  const store = useAppState();
  const { columns, gridItemWidth } = useTabContent();
  const apptColumns = columns(APPOINTMENT_MIN_WIDTH, { gutter: 8, max: 2 });
  /** Loaded and nothing booked: the centred empty state replaces the list and fills the tab. */
  const isEmpty = !store.bootstrapping && store.appts.length === 0;

  // Was the literal string "Thursday, 24 June" — it never changed with the date. Locale-
  // formatted like the calendar's month label, so it needs no dictionary entry.
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
    [],
  );

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    store.staff.forEach((st) => (map[st.id] = st.name));
    return map;
  }, [store.staff]);

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
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh} grow={isEmpty}>
        <TScopeNotice />
        <TSectionTitle>{t.appointments.upcomingToday}</TSectionTitle>
        {isEmpty ? (
          <TEmptyState fill icon="calendar" title={t.appointments.empty} hint={t.appointments.emptyHint} />
        ) : (
          <View style={apptColumns > 1 ? apptStyles.grid : styles.g2}>
            {store.bootstrapping && store.appts.length === 0 ? (
              SKELETON_ROWS.map((k) => (
                <View key={k} style={apptColumns > 1 ? { width: gridItemWidth(apptColumns) } : undefined}>
                  <TAppointmentRowSkeleton />
                </View>
              ))
            ) : (
              store.appts.map((a) => (
                <View
                  key={a.id}
                  style={apptColumns > 1 ? { width: gridItemWidth(apptColumns) } : undefined}>
                  <AppointmentListItem
                    appointment={a}
                    staffName={a.staffId ? staffById[a.staffId] : undefined}
                    checkInLoading={store.checkInId === a.id}
                    onCheckIn={store.checkInAppt}
                  />
                </View>
              ))
            )}
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
});
