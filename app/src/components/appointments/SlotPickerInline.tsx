import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common';
import { TMonthGrid } from '@/components/common/TMonthGrid';
import { t } from '@/i18n';
import { ApiError, type SlotsResponse } from '@/lib/api';
import type { DayHoursVM } from '@/lib/hours';
import { seriesDay } from '@/lib/series';
import { storeTodayKey } from '@/lib/zoned';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/** A free time the person picked: the instant to send back, its store-local day and label. */
export interface PickedSlot {
  date: string;
  startAt: string;
  label: string;
}

/** A stylist chip. `value` undefined = "keep" (the booking's or series' own stylist). */
export interface StaffOption {
  value: string | undefined;
  label: string;
}

/** Weekdays the store is shut, from its hours — only to tell "Closed this day" from "no free times". */
export function closedWeekdaysOf(hours: DayHoursVM[] | undefined): Set<number> | undefined {
  if (!hours?.length) return undefined;
  return new Set(hours.filter((h) => !h.open).map((h) => h.dayOfWeek));
}

/**
 * Pick a free time: a day (the Calendar-style month grid), a stylist, then a time — for moving a
 * visit, a series change's new time, a conflict's other time and "Book another time".
 *
 * INLINE, never its own modal: it is used inside the series sheet, and iOS will not present a
 * second modal over an open one (see CommissionEditSheet). That is also why it is not built on
 * TimeSelect, which opens a sheet of its own. Pure JS — no native date picker, so no new build.
 *
 * The API decides everything about time: which days may be offered (`today` … `lastDay`, the
 * store's calendar) and which instants are free. The picker only ever sends a slot's `startAt`
 * back, so it can never build a time on the phone's clock.
 */
export function SlotPickerInline({
  fetchSlots,
  initialDate,
  fixedDate = false,
  staffOptions,
  staffValue,
  onStaffChange,
  value,
  onChange,
  keepTimeLabel,
  timeLabel = t.appointments.pickTime,
  closedWeekdays,
}: {
  fetchSlots: (date: string, staffId: string | undefined) => Promise<SlotsResponse>;
  /** The store-local day to open on. */
  initialDate: string;
  /** Only `initialDate` — a series change's first date, a conflict's date, a flagged date. */
  fixedDate?: boolean;
  /** Null or absent: no stylist row (a staff login keeps its own chair). */
  staffOptions?: StaffOption[] | null;
  staffValue?: string;
  onStaffChange?: (value: string | undefined) => void;
  value: PickedSlot | null;
  onChange: (slot: PickedSlot | null) => void;
  /** Adds a chip that picks "no new time" (value null) — "Keep current time". */
  keepTimeLabel?: string;
  timeLabel?: string;
  closedWeekdays?: Set<number>;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);

  const [date, setDate] = useState(initialDate);
  /** The store's own range, from the first answer. Until then: the store's today, no end. */
  const [range, setRange] = useState<{ today: string; lastDay: string } | null>(null);
  /**
   * The last answer and the request it answers. "Loading" is derived — the answer on hand is not
   * for the day and stylist now chosen — rather than set inside the effect, so a quick second tap
   * can never be overwritten by the first tap's slower answer.
   */
  const key = `${date}|${staffValue ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; res: SlotsResponse } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSlots(date, staffValue)
      .then((res) => {
        if (!alive) return;
        setLoaded({ key: `${date}|${staffValue ?? ''}`, res });
        setRange({ today: res.today, lastDay: res.lastDay });
      })
      .catch((e) => {
        if (alive) setFailed({ key: `${date}|${staffValue ?? ''}`, message: (e as ApiError)?.message ?? t.toast.error });
      });
    return () => {
      alive = false;
    };
    // `fetchSlots` is a fresh closure on every parent render; the request depends only on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, staffValue]);

  const current = loaded?.key === key ? loaded.res : null;
  const error = failed?.key === key ? failed.message : null;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const closed = !!closedWeekdays?.has(weekday);

  const pickDay = (next: string) => {
    if (next === date) return;
    setDate(next);
    onChange(null);
  };
  const pickStaff = (next: string | undefined) => {
    if (next === staffValue) return;
    onStaffChange?.(next);
    onChange(null);
  };

  const chip = (selected: boolean) => [
    s.chip,
    {
      borderColor: selected ? colors.primary : colors.borderDefault,
      backgroundColor: selected ? colors.primary : colors.surfaceCard,
    },
  ];
  const chipText = (selected: boolean) => ({ color: selected ? colors.textOnBrand : colors.textBody });

  return (
    <View style={s.root}>
      <View>
        <TText variant="caption" color="textMuted" weight="semibold" style={s.label}>
          {t.appointments.pickDay}
        </TText>
        {fixedDate ? (
          <TText variant="bodySm" color="textStrong" weight="semibold">
            {seriesDay(date)}
          </TText>
        ) : (
          <TMonthGrid
            mode="single"
            value={{ from: date, to: date }}
            onChange={(r) => r.from && pickDay(r.from)}
            todayKey={range?.today ?? storeTodayKey()}
            minKey={range?.today ?? storeTodayKey()}
            maxKey={range?.lastDay}
          />
        )}
      </View>

      {staffOptions && staffOptions.length > 0 ? (
        <View>
          <TText variant="caption" color="textMuted" weight="semibold" style={s.label}>
            {t.appointments.pickStylist}
          </TText>
          <View style={s.chips}>
            {staffOptions.map((o) => {
              const selected = o.value === staffValue;
              return (
                <Pressable
                  key={o.value ?? 'keep'}
                  onPress={() => pickStaff(o.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={chip(selected)}>
                  <TText variant="bodySm" weight="semibold" style={chipText(selected)}>
                    {o.label}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View>
        <TText variant="caption" color="textMuted" weight="semibold" style={s.label}>
          {timeLabel}
        </TText>
        <View style={s.chips}>
          {keepTimeLabel ? (
            <Pressable
              onPress={() => onChange(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: value === null }}
              style={chip(value === null)}>
              <TText variant="bodySm" weight="semibold" style={chipText(value === null)}>
                {keepTimeLabel}
              </TText>
            </Pressable>
          ) : null}
          {current?.slots.map((slot) => {
            const selected = value?.startAt === slot.startAt;
            return (
              <Pressable
                key={slot.startAt}
                onPress={() => onChange({ date, startAt: slot.startAt, label: slot.label })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={chip(selected)}>
                <TText variant="bodySm" weight="semibold" style={chipText(selected)}>
                  {slot.label}
                </TText>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <TText variant="bodySm" color="error" style={s.note}>
            {error}
          </TText>
        ) : !current ? (
          <TText variant="bodySm" color="textMuted" style={s.note}>
            {t.appointments.loadingTimes}
          </TText>
        ) : current.slots.length === 0 ? (
          <TText variant="bodySm" color="textMuted" style={s.note}>
            {closed ? t.appointments.closedDay : t.appointments.noTimes}
          </TText>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = ({ radius }: ThemeStyleProps) =>
  StyleSheet.create({
    root: { gap: moderateScale(12) },
    label: { marginBottom: moderateScale(6) },
    chips: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8) },
    chip: {
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(radius.pill),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(8),
    },
    note: { marginTop: moderateScale(2) },
  });
