import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { THeader, TScopeNotice, TScreenScroll, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/i18n';
import { toDateKey } from '@/lib/mappers';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

const GRID_CELLS = 42; // 6 weeks × 7 days — always covers a month plus lead/trail days.

function startOfGrid(year: number, month: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  return new Date(year, month, 1 - firstOfMonth.getDay());
}

function buildGrid(year: number, month: number): Date[] {
  const start = startOfGrid(year, month);
  return Array.from(
    { length: GRID_CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export default function Calendar() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createCalendarStyles(theme), [theme]);

  const today = useMemo(() => new Date(), []);
  const [visibleYear, setVisibleYear] = useState(today.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);

  const selectDay = (cell: Date) => {
    setSelectedDate(cell);
    store.openDayAppts(toDateKey(cell));
  };

  const grid = useMemo(() => buildGrid(visibleYear, visibleMonth), [visibleYear, visibleMonth]);

  useEffect(() => {
    store.loadCalendarAppointments(toDateKey(grid[0]), toDateKey(grid[grid.length - 1]));
    // Re-fetch only when the visible month changes — `store.loadCalendarAppointments`
    // is stable but including it would re-run this on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleYear, visibleMonth]);

  const bookedDays = useMemo(() => {
    const set = new Set<string>();
    store.calendarAppts.forEach((a) => set.add(a.dateKey));
    return set;
  }, [store.calendarAppts]);

  const selectedKey = toDateKey(selectedDate);
  const todayKey = toDateKey(today);

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
            const key = toDateKey(cell);
            const inMonth = cell.getMonth() === visibleMonth;
            const isSelected = key === selectedKey;
            const isToday = key === todayKey;
            const hasAppts = bookedDays.has(key);
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
                <View style={s.dotSlot}>{hasAppts && <View style={s.dot} />}</View>
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
    dotSlot: { height: moderateScale(6), ...styles.itemsCenter, ...styles.justifyCenter, ...styles.mt1 },
    dot: {
      width: moderateScale(4),
      height: moderateScale(4),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.primary,
    },
  });
