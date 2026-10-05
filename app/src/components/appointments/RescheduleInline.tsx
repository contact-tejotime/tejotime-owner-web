import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { format, t } from '@/i18n';
import { api } from '@/lib/api';
import { seriesDay, slotWhen } from '@/lib/series';
import { storeDayKey, storeTodayKey } from '@/lib/zoned';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

import { closedWeekdaysOf, SlotPickerInline, type PickedSlot, type StaffOption } from './SlotPickerInline';

/**
 * The stylist chips for an owner: every active stylist, then "Any stylist". A staff login gets
 * none — it may only book onto its own chair (the API answers 403 otherwise), so it keeps it.
 */
function useStaffOptions(): StaffOption[] | null {
  const store = useAppState();
  return useMemo(() => {
    if (store.session?.role === 'staff') return null;
    return [
      ...store.staff.map((st) => ({ value: st.id as string | undefined, label: st.name })),
      { value: 'any', label: t.series.anyStylist },
    ];
  }, [store.session?.role, store.staff]);
}

/** Start on someone who is still on the books, or "Any stylist" when they have left. */
function initialStaff(staffId: string | null | undefined, options: StaffOption[] | null): string | undefined {
  if (!options) return undefined;
  return staffId && options.some((o) => o.value === staffId) ? staffId : 'any';
}

/**
 * "Move visit" for one booking — one-off or a visit of a repeating booking — from an appointment
 * row's "⋮" strip or the series sheet. Pick a day, stylist and time; confirm; the store moves it
 * and toasts "Visit moved". Nothing is texted (the client's SMS rule), and the confirmation says so.
 */
export function MoveVisitInline({
  appointmentId,
  startAt,
  staffId,
  busy,
  onMove,
  onBack,
}: {
  appointmentId: string;
  startAt: string;
  staffId: string | null | undefined;
  busy: boolean;
  /** Resolves true when it worked. */
  onMove: (slotStart: string, staffId: string | undefined) => Promise<boolean>;
  onBack: () => void;
}) {
  const store = useAppState();
  const options = useStaffOptions();
  const [staff, setStaff] = useState<string | undefined>(() => initialStaff(staffId, options));
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  // Opens on the booking's own day — on the store's calendar, and never before its today.
  const [opening] = useState(() => {
    const day = storeDayKey(startAt);
    const today = storeTodayKey();
    return day < today ? today : day;
  });

  return (
    <View style={s.root}>
      <TText variant="bodySm" color="textStrong" weight="bold">
        {t.appointments.moveTitle}
      </TText>
      <SlotPickerInline
        fetchSlots={(date, st) => api.getAppointmentSlots(appointmentId, date, st)}
        initialDate={opening}
        staffOptions={options}
        staffValue={staff}
        onStaffChange={setStaff}
        value={slot}
        onChange={setSlot}
        closedWeekdays={closedWeekdaysOf(store.business?.hours)}
      />
      {slot ? (
        <View style={s.confirm}>
          <TText variant="bodySm" color="textStrong" weight="semibold">
            {format(t.appointments.moveConfirm, { when: slotWhen(slot.date, slot.label) })}
          </TText>
          <TText variant="caption" color="textMuted">
            {t.appointments.noText}
          </TText>
          <View style={s.buttons}>
            <TButton size="sm" loading={busy} onPress={() => void onMove(slot.startAt, staff)}>
              {t.appointments.moveYes}
            </TButton>
            <TButton variant="outline" size="sm" disabled={busy} onPress={() => setSlot(null)}>
              {t.common.back}
            </TButton>
          </View>
        </View>
      ) : (
        <TButton variant="outline" size="sm" onPress={onBack}>
          {t.common.back}
        </TButton>
      )}
    </View>
  );
}

/**
 * "Book another time" for a Needs attention date: that one flagged date, at a time (and stylist)
 * the owner picks after phoning the customer. The store books it, closes the item and toasts
 * "Visit booked". Nothing is texted.
 */
export function BookAnotherInline({
  seriesId,
  date,
  staffId,
  busy,
  onBook,
  onBack,
}: {
  seriesId: string;
  /** The flagged date, store-local. */
  date: string;
  staffId: string | null | undefined;
  busy: boolean;
  onBook: (slotStart: string, staffId: string | undefined) => Promise<boolean>;
  onBack: () => void;
}) {
  const store = useAppState();
  const options = useStaffOptions();
  const [staff, setStaff] = useState<string | undefined>(() => initialStaff(staffId, options));
  const [slot, setSlot] = useState<PickedSlot | null>(null);

  return (
    <View style={s.root}>
      <TText variant="bodySm" color="textStrong" weight="bold">
        {format(t.series.bookTitle, { date: seriesDay(date) })}
      </TText>
      <SlotPickerInline
        fetchSlots={(d, st) => api.getSeriesSlots(seriesId, d, st)}
        initialDate={date}
        fixedDate
        staffOptions={options}
        staffValue={staff}
        onStaffChange={setStaff}
        value={slot}
        onChange={setSlot}
        closedWeekdays={closedWeekdaysOf(store.business?.hours)}
      />
      {/* The same confirm shape as Move visit, in owner-web's words: Back drops the picked time. */}
      {slot ? (
        <View style={s.confirm}>
          <TText variant="bodySm" color="textStrong" weight="semibold">
            {format(t.series.bookConfirm, { when: slotWhen(slot.date, slot.label) })}
          </TText>
          <TText variant="caption" color="textMuted">
            {t.appointments.noText}
          </TText>
          <View style={s.buttons}>
            <TButton size="sm" loading={busy} onPress={() => void onBook(slot.startAt, staff)}>
              {t.series.bookYes}
            </TButton>
            <TButton variant="outline" size="sm" disabled={busy} onPress={() => setSlot(null)}>
              {t.common.back}
            </TButton>
          </View>
        </View>
      ) : (
        <TButton variant="outline" size="sm" onPress={onBack}>
          {t.common.back}
        </TButton>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: moderateScale(12) },
  confirm: { gap: moderateScale(6) },
  buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8), marginTop: moderateScale(2) },
});
