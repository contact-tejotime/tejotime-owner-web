import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/i18n';
import { formatDayKey } from '@/lib/commission';
import { buildGrid, dayKeyOf, monthOfKey } from '@/lib/date-grid';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export interface DayRange {
  from: string | null;
  to: string | null;
}

/**
 * A month of days to pick from: one day (a commission rate's "Starts on") or a range (Reports'
 * custom dates). Drawn like the Calendar tab — the same Sunday-first, 6-week grid (lib/date-grid).
 *
 * Pure JS on purpose. A native date-picker module would mean a new native build for every owner,
 * and this sits INLINE in a sheet: iOS will not present a second modal over an open one, so a
 * picker that opened its own dialog from inside the commission sheet would simply never appear.
 *
 * Days are `YYYY-MM-DD` keys. `todayKey`, `minKey` and `maxKey` come from the API — the store's own
 * calendar — never from this device's clock, which may be in another timezone.
 *
 * Range mode: the first tap starts a range, the second ends it; tapping before the start (or after
 * a finished range) starts again.
 */
export function TMonthGrid({
  mode,
  value,
  onChange,
  todayKey,
  minKey,
  maxKey,
}: {
  mode: 'single' | 'range';
  value: DayRange;
  onChange: (next: DayRange) => void;
  todayKey: string;
  minKey?: string;
  maxKey?: string;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const opening = monthOfKey(value.from ?? todayKey);
  const [year, setYear] = useState(opening.year);
  const [month, setMonth] = useState(opening.month);
  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  const goToMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const pick = (key: string) => {
    if (mode === 'single') {
      onChange({ from: key, to: key });
      return;
    }
    if (!value.from || value.to || key < value.from) {
      onChange({ from: key, to: null });
      return;
    }
    onChange({ from: value.from, to: key });
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={s.nav}>
        <IconButton variant="ghost" accessibilityLabel={t.commission.prevMonth} onPress={() => goToMonth(-1)}>
          <Icon name="chevronLeft" size={20} color={colors.textBody} />
        </IconButton>
        <TText variant="bodyMd" color="textStrong" weight="semibold">
          {monthLabel}
        </TText>
        <IconButton variant="ghost" accessibilityLabel={t.commission.nextMonth} onPress={() => goToMonth(1)}>
          <Icon name="chevronRight" size={20} color={colors.textBody} />
        </IconButton>
      </View>

      <View style={s.week}>
        {t.days.short.map((d, i) => (
          <TText key={`${d}-${i}`} variant="caption" color="textSubtle" weight="semibold" style={s.weekCell}>
            {d}
          </TText>
        ))}
      </View>

      <View style={s.grid}>
        {grid.map((cell) => {
          const key = dayKeyOf(cell);
          const inMonth = cell.getMonth() === month;
          const disabled = (minKey != null && key < minKey) || (maxKey != null && key > maxKey);
          const isEnd = key === value.from || key === value.to;
          const inRange = !!value.from && !!value.to && key > value.from && key < value.to;
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              onPress={() => pick(key)}
              disabled={disabled}
              style={s.cell}
              accessibilityRole="button"
              accessibilityLabel={formatDayKey(key, { weekday: true, year: true })}
              accessibilityState={{ selected: isEnd, disabled }}>
              <View
                style={[
                  s.cellInner,
                  inRange && { backgroundColor: colors.primarySoft },
                  isEnd && { backgroundColor: colors.primary },
                  !isEnd && isToday && s.cellToday,
                ]}>
                <TText
                  variant="bodySm"
                  weight={isEnd ? 'semibold' : 'medium'}
                  style={{
                    color: isEnd ? colors.textOnBrand : inMonth && !disabled ? colors.textBody : colors.textSubtle,
                    opacity: disabled ? 0.45 : 1,
                  }}>
                  {cell.getDate()}
                </TText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Roomier than the Calendar tab's 40: these cells are the only way to pick, so they are a full tap. */
const CELL_SIZE = moderateScale(42);

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    nav: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, ...styles.mb2 },
    week: { ...styles.flexRow, ...styles.mb2 },
    weekCell: { flex: 1, textAlign: 'center' },
    grid: { ...styles.flexRow, flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, alignItems: 'center', ...styles.mb1 },
    cellInner: {
      width: CELL_SIZE,
      height: CELL_SIZE,
      borderRadius: moderateScale(radius.pill),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
    cellToday: { borderWidth: moderateScale(1), borderColor: colors.primary },
  });
