import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { t } from '@/i18n';
import {
  api,
  ApiError,
  type ChangeInput,
  type ChangePreview,
  type ChangeResolution,
  type SeriesDTO,
  type SeriesDetail,
} from '@/lib/api';
import { formatClock } from '@/lib/commission';
import { seriesDay, slotWhen } from '@/lib/series';
import { showToast } from '@/lib/toast';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

import { closedWeekdaysOf, SlotPickerInline, type PickedSlot } from './SlotPickerInline';

/** A conflict's choice, as shown: another time (with its label) or a skip. */
type Choice = { slotStart: string; label: string } | 'skip';

/**
 * "Change future visits" — a new time and/or a new stylist from one of the series' upcoming dates
 * on (never a new interval: the client's spec). The app's twin of owner-web's change mode.
 *
 *  1. **From** — one of `changeFromDates` (the API's: today up to the first date not booked yet).
 *  2. **Stylist** and **New time** — "Keep current …" by default; the times are that first date's.
 *  3. **Preview** — each date's fate. A date the new time does not fit ("taken") must get **another
 *     time** or be **skipped** before **Change visits** is allowed: nothing is cancelled or flagged
 *     behind the owner's back. A visit moved by hand keeps its time ("kept").
 *  4. **Change visits** — if a chosen time went meanwhile (409 CHANGE_CONFLICTS), those dates open
 *     again on a fresh preview.
 *
 * Nothing is texted (the client's SMS rule); the confirmation says so.
 */
export function ChangeFuturePanel({
  series,
  detail,
  onDone,
  onBack,
}: {
  series: SeriesDTO;
  detail: SeriesDetail;
  onDone: (next: SeriesDetail) => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const store = useAppState();
  // A staff login may only keep the series on its own chair (the API answers 403 otherwise).
  const staffOptions = useMemo(
    () =>
      store.session?.role === 'staff'
        ? null
        : [
            { value: undefined as string | undefined, label: t.series.keepStylist },
            ...store.staff.map((st) => ({ value: st.id as string | undefined, label: st.name })),
            { value: 'any' as string | undefined, label: t.series.anyStylist },
          ],
    [store.session?.role, store.staff],
  );
  const closedWeekdays = closedWeekdaysOf(store.business?.hours);

  const [fromDate, setFromDate] = useState(detail.changeFromDates[0]);
  const [staff, setStaff] = useState<string | undefined>(undefined);
  const [newTime, setNewTime] = useState<PickedSlot | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  /** The conflict date whose "Pick another time" picker is open. */
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const input = (): ChangeInput => ({
    fromDate,
    ...(newTime ? { slotStart: newTime.startAt } : {}),
    ...(staff !== undefined ? { staffId: staff } : {}),
  });
  const nothingChosen = !newTime && staff === undefined;

  /** Any change to the inputs makes the preview stale — drop it rather than show the wrong dates. */
  const resetPreview = () => {
    setPreview(null);
    setChoices({});
    setPicking(null);
  };

  const runPreview = async (keep: Record<string, Choice> = {}) => {
    setPreviewing(true);
    try {
      const p = await api.previewSeriesChange(series.id, input());
      setPreview(p);
      // Keep a choice only for a date that still needs one.
      setChoices(Object.fromEntries(Object.entries(keep).filter(([d]) => p.conflicts.includes(d))));
      setPicking(null);
    } catch (e) {
      showToast((e as ApiError)?.message ?? t.toast.error, 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const unresolved = preview ? preview.conflicts.filter((d) => !choices[d]) : [];

  const apply = async () => {
    if (!preview || unresolved.length) return;
    const resolutions: ChangeResolution[] = preview.conflicts.map((date) => {
      const c = choices[date];
      return c === 'skip' ? { date, skip: true as const } : { date, slotStart: c.slotStart };
    });
    setSaving(true);
    try {
      const next = await api.changeSeries(series.id, { ...input(), ...(resolutions.length ? { resolutions } : {}) });
      showToast(t.series.changed, 'success');
      onDone(next);
    } catch (e) {
      const err = e as ApiError;
      if (err?.status === 409 && err.code === 'CHANGE_CONFLICTS') {
        // A chosen time (or the new time itself) went while the owner was deciding. Open those
        // dates again on a fresh preview; every other choice stands.
        showToast(t.series.changeConflicts, 'error');
        const stale = new Set(err.details.map((d) => d.rule).filter((d): d is string => !!d));
        await runPreview(Object.fromEntries(Object.entries(choices).filter(([d]) => !stale.has(d))));
      } else {
        showToast(err?.message ?? t.toast.error, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const chip = (selected: boolean) => [
    s.chip,
    {
      borderColor: selected ? colors.primary : colors.borderDefault,
      backgroundColor: selected ? colors.primary : colors.surfaceCard,
    },
  ];
  const chipText = (selected: boolean) => ({ color: selected ? colors.textOnBrand : colors.textBody });

  /** The conflicts' times are the changed series' — on its new stylist ('any' when it has none). */
  const conflictStaff = preview ? (preview.staffId ?? 'any') : undefined;

  return (
    <View style={s.root}>
      <TText variant="bodySm" color="textStrong" weight="bold">
        {t.series.changeFuture}
      </TText>

      <View>
        <TText variant="caption" color="textMuted" weight="semibold" style={s.label}>
          {t.series.changeFrom}
        </TText>
        <View style={s.chips}>
          {detail.changeFromDates.map((d) => (
            <Pressable
              key={d}
              onPress={() => {
                if (d === fromDate) return;
                setFromDate(d);
                setNewTime(null);
                resetPreview();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: d === fromDate }}
              style={chip(d === fromDate)}>
              <TText variant="bodySm" weight="semibold" style={chipText(d === fromDate)}>
                {seriesDay(d)}
              </TText>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Remounted per first date: the new time is always a slot ON it (the API's rule). */}
      <SlotPickerInline
        key={fromDate}
        fetchSlots={(d, st) => api.getSeriesSlots(series.id, d, st, fromDate)}
        initialDate={fromDate}
        fixedDate
        staffOptions={staffOptions}
        staffValue={staff}
        onStaffChange={(v) => {
          setStaff(v);
          resetPreview();
        }}
        value={newTime}
        onChange={(v) => {
          setNewTime(v);
          resetPreview();
        }}
        keepTimeLabel={t.series.keepTime}
        timeLabel={t.series.newTime}
        closedWeekdays={closedWeekdays}
      />

      {!preview ? (
        <View style={s.buttons}>
          <TButton size="sm" loading={previewing} disabled={nothingChosen} onPress={() => void runPreview()}>
            {t.series.preview}
          </TButton>
          <TButton variant="outline" size="sm" disabled={previewing} onPress={onBack}>
            {t.common.back}
          </TButton>
        </View>
      ) : (
        <>
          <View style={[s.list, { borderColor: colors.borderSubtle }]}>
            {preview.dates.map((row, i) => {
              const choice = choices[row.date];
              const taken = row.status === 'taken';
              return (
                <View
                  key={row.date}
                  style={[s.dateRow, i > 0 && { borderTopColor: colors.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <TText variant="bodySm" color="textStrong" weight="semibold">
                    {row.status === 'ok'
                      ? `${seriesDay(row.date)}, ${formatClock(preview.startTime)}`
                      : taken && choice && choice !== 'skip'
                        ? slotWhen(row.date, choice.label)
                        : seriesDay(row.date)}
                  </TText>
                  {/* A conflict given another time shows that time above, and its highlighted
                      "Pick another time" below — no caption. */}
                  {row.status !== 'ok' && !(taken && choice && choice !== 'skip') ? (
                    <TText
                      variant="caption"
                      style={{ color: taken && !choice ? colors.warningSoftFg : colors.textMuted }}>
                      {taken
                        ? choice === 'skip'
                          ? t.series.skipped
                          : t.series.dateTaken
                        : row.status === 'kept'
                          ? t.series.dateKept
                          : row.status === 'skipped'
                            ? t.series.skipped
                            : row.status === 'closed'
                              ? t.series.dateClosed
                              : t.series.dateLater}
                    </TText>
                  ) : null}
                  {taken ? (
                    picking === row.date ? (
                      <View style={s.picker}>
                        <SlotPickerInline
                          fetchSlots={(d) => api.getSeriesSlots(series.id, d, conflictStaff, fromDate)}
                          initialDate={row.date}
                          fixedDate
                          value={null}
                          onChange={(v) => {
                            if (!v) return;
                            setChoices((c) => ({ ...c, [row.date]: { slotStart: v.startAt, label: v.label } }));
                            setPicking(null);
                          }}
                          closedWeekdays={closedWeekdays}
                        />
                        <TButton variant="outline" size="sm" onPress={() => setPicking(null)}>
                          {t.common.back}
                        </TButton>
                      </View>
                    ) : (
                      <View style={s.buttons}>
                        <TButton
                          variant={choice && choice !== 'skip' ? 'primary' : 'outline'}
                          size="sm"
                          disabled={saving}
                          onPress={() => setPicking(row.date)}>
                          {t.series.pickAnother}
                        </TButton>
                        <TButton
                          variant={choice === 'skip' ? 'primary' : 'outline'}
                          size="sm"
                          disabled={saving}
                          onPress={() => setChoices((c) => ({ ...c, [row.date]: 'skip' }))}>
                          {t.series.skipDate}
                        </TButton>
                      </View>
                    )
                  ) : null}
                </View>
              );
            })}
          </View>

          <TText variant="caption" color="textMuted">
            {t.appointments.noText}
          </TText>
          <View style={s.buttons}>
            <TButton size="sm" loading={saving} disabled={unresolved.length > 0} onPress={() => void apply()}>
              {t.series.changeVisits}
            </TButton>
            <TButton variant="outline" size="sm" disabled={saving} onPress={resetPreview}>
              {t.common.back}
            </TButton>
          </View>
        </>
      )}
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
    list: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: moderateScale(radius.md),
      paddingHorizontal: moderateScale(12),
    },
    dateRow: { paddingVertical: moderateScale(10), gap: moderateScale(4) },
    picker: { gap: moderateScale(10), marginTop: moderateScale(6) },
    buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8) },
  });
