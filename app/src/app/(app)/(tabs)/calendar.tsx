import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { THeader, TScopeNotice, TScreenScroll, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/i18n';
// Shared with the date pickers (TMonthGrid) — the same 6-week, Sunday-first month.
import { buildGrid, dayKeyOf, monthOfKey } from '@/lib/date-grid';
import { storeTodayKey } from '@/lib/zoned';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function Calendar() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createCalendarStyles(theme), [theme]);

  /**
   * Today on the STORE's calendar (lib/zoned.ts), not the phone's: bookings are grouped onto days
   * by their store-local date, so "today" has to be the same calendar. Grid cells are calendar
   * dates, not instants, and are keyed by their own parts (`dayKeyOf`) — never through a timezone.
   * Computed once per visit to the tab; the zone arrives with /auth/me, before this can mount.
   */
  const [todayKey] = useState(() => storeTodayKey());
  const [visibleYear, setVisibleYear] = useState(() => monthOfKey(todayKey).year);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOfKey(todayKey).month);
  const [selectedKey, setSelectedKey] = useState(todayKey);

  const selectDay = (cell: Date) => {
    const key = dayKeyOf(cell);
    setSelectedKey(key);
    store.openDayAppts(key);
  };

  const grid = useMemo(() => buildGrid(visibleYear, visibleMonth), [visibleYear, visibleMonth]);

  useEffect(() => {
    store.loadCalendarAppointments(dayKeyOf(grid[0]), dayKeyOf(grid[grid.length - 1]));
    // Re-fetch only when the visible month changes — `store.loadCalendarAppointments`
    // is stable but including it would re-run this on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleYear, visibleMonth]);

  /** Days with any booking, and the days with a visit of a repeating booking among them. */
  const { bookedDays, seriesDays } = useMemo(() => {
    const booked = new Set<string>();
    const series = new Set<string>();
    store.calendarAppts.forEach((a) => {
      booked.add(a.dateKey);
      if (a.seriesId && a.cancelReason !== 'skipped' && a.status !== 'cancelled') series.add(a.dateKey);
    });
    return { bookedDays: booked, seriesDays: series };
  }, [store.calendarAppts]);

  const goToMonth = (delta: number) => {
    const next = new Date(visibleYear, visibleMonth + delta, 1);
    setVisibleYear(next.getFullYear());
    setVisibleMonth(next.getMonth());
  };

  const monthLabel = new Date(visibleYear, visibleMonth, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <>
      <THeader title={t.calendar.title} />
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TScopeNotice />
        <View style={s.monthNav}>
          <IconButton variant="ghost" accessibilityLabel={t.calendar.prevMonth} onPress={() => goToMonth(-1)}>
            <Icon name="chevronLeft" size={20} color={theme.colors.textBody} />
          </IconButton>
          <TText variant="h5" color="textStrong" weight="semibold">
            {monthLabel}
          </TText>
          <IconButton variant="ghost" accessibilityLabel={t.calendar.nextMonth} onPress={() => goToMonth(1)}>
            <Icon name="chevronRight" size={20} color={theme.colors.textBody} />
          </IconButton>
        </View>

        <View style={s.weekRow}>
          {t.days.short.map((d, i) => (
            <TText key={`${d}-${i}`} variant="caption" color="textSubtle" weight="semibold" style={s.weekCell}>
              {d}
            </TText>
          ))}
        </View>

        <View style={[s.grid, store.calendarLoading && s.gridLoading]}>
          {grid.map((cell) => {
            const key = dayKeyOf(cell);
            const inMonth = cell.getMonth() === visibleMonth;
            const isSelected = key === selectedKey;
            const isToday = key === todayKey;
            const hasAppts = bookedDays.has(key);
            const hasSeries = seriesDays.has(key);
            return (
              <Pressable key={key} onPress={() => selectDay(cell)} style={s.cell}>
                <View style={[s.cellInner, isSelected && s.cellSelected, !isSelected && isToday && s.cellToday]}>
                  <TText
                    variant="bodySm"
                    weight={isSelected ? 'semibold' : 'medium'}
                    color={isSelected ? 'inherit' : inMonth ? 'textBody' : 'textSubtle'}
                    style={isSelected ? s.cellTextSelected : undefined}>
                    {cell.getDate()}
                  </TText>
                </View>
                {/* A repeating booking's visit marks its day with the repeat glyph instead of
                    the plain dot — the same icon as on its row. */}
                <View style={s.dotSlot}>
                  {hasSeries ? (
                    <View accessible accessibilityLabel={t.series.repeating}>
                      <Icon name="repeat" size={9} strokeWidth={2.5} color={theme.colors.primary} />
                    </View>
                  ) : hasAppts ? (
                    <View style={s.dot} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </TScreenScroll>
    </>
  );
}

const CELL_SIZE = moderateScale(40);

const createCalendarStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    monthNav: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, ...styles.mb3 },
    weekRow: { ...styles.flexRow, ...styles.mb2 },
    weekCell: { flex: 1, textAlign: 'center' },
    grid: { ...styles.flexRow, flexWrap: 'wrap' },
    gridLoading: { opacity: 0.5 },
    cell: { width: `${100 / 7}%`, alignItems: 'center', ...styles.mb2 },
    cellInner: {
      width: CELL_SIZE,
      height: CELL_SIZE,
      borderRadius: moderateScale(radius.pill),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
    cellSelected: { backgroundColor: colors.primary },
    cellToday: { borderWidth: moderateScale(1), borderColor: colors.primary },
    cellTextSelected: { color: colors.textOnBrand },
    // Tall enough for the repeat glyph (9) as well as the dot (4), so marked days don't jump.
    dotSlot: { height: moderateScale(10), ...styles.itemsCenter, ...styles.justifyCenter, ...styles.mt1 },
    dot: {
      width: moderateScale(4),
      height: moderateScale(4),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.primary,
    },
  });
