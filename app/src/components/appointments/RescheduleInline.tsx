import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { format, t } from '@/i18n';
import { api } from '@/lib/api';
import { seriesDay, slotWhen } from '@/lib/series';
import { storeDayKey, storeTodayKey } from '@/lib/zoned';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

import { closedWeekdaysOf, SlotPickerInline, type PickedSlot, type StaffOption } from './SlotPickerInline';

/**
 * The stylist chips for an owner: every active stylist, then "Any stylist". A staff login gets
 * none — it may only book onto its own chair (the API answers 403 otherwise), so it keeps it.
 */
export function useStaffOptions(): StaffOption[] | null {
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
export function initialStaff(staffId: string | null | undefined, options: StaffOption[] | null): string | undefined {
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

/**
 * "Book a visit" for a customer on the "Due to come back" list (docs/customer-due-list.md), after
 * the owner has agreed a day and time on the call. Opens on their expected day with their last
 * visit's services and stylist; the services can be changed, since they set the visit's length and
 * so the free times. The store books it and toasts "Visit booked". Nothing is texted.
 *
 * Unlike Book another time, the day is free to change — the customer picks it on the phone.
 */
export function BookNewInline({
  initialDate,
  staffId,
  serviceIds: initialServices,
  servicesResolved,
  busy,
  onBook,
  onBack,
}: {
  /** Store-local day to open on (their expected day, or today). */
  initialDate: string;
  staffId: string | null | undefined;
  serviceIds: string[];
  servicesResolved: boolean;
  busy: boolean;
  /** Resolves true when it worked; false (taken meanwhile, or refused) re-reads the times. */
  onBook: (slotStart: string, staffId: string | undefined, serviceIds: string[]) => Promise<boolean>;
  onBack: () => void;
}) {
  const store = useAppState();
  const { colors } = useTheme();
  const options = useStaffOptions();
  const [staff, setStaff] = useState<string | undefined>(() => initialStaff(staffId, options));
  const [services, setServices] = useState<string[]>(() =>
    initialServices.filter((id) => store.services.some((sv) => sv.id === id)),
  );
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [reload, setReload] = useState(0);
  const [opening] = useState(() => {
    const today = storeTodayKey();
    return initialDate < today ? today : initialDate;
  });
  // A store with services needs at least one picked: its length sets the free times.
  const needService = store.services.length > 0 && services.length === 0;

  const toggle = (id: string) => {
    setSlot(null);
    setServices((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };
  const confirm = async (picked: PickedSlot) => {
    const ok = await onBook(picked.startAt, staff, services);
    if (!ok) {
      setSlot(null);
      setReload((r) => r + 1);
    }
  };

  return (
    <View style={s.root}>
      <TText variant="bodySm" color="textStrong" weight="bold">
        {t.customers.due.bookTitle}
      </TText>
      {store.services.length > 0 ? (
        <View style={s.services}>
          <TText variant="caption" color="textMuted" weight="semibold">
            {t.customers.due.services}
          </TText>
          {!servicesResolved ? (
            <TText variant="caption" color="warningSoftFg">
              {t.customers.due.checkServices}
            </TText>
          ) : null}
          <View style={s.buttons}>
            {store.services.map((sv) => {
              const on = services.includes(sv.id);
              return (
                <Pressable
                  key={sv.id}
                  disabled={busy}
                  onPress={() => toggle(sv.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: busy }}
                  style={[
                    s.chip,
                    {
                      borderColor: on ? colors.primary : colors.borderDefault,
                      backgroundColor: on ? colors.primary : colors.surfaceCard,
                    },
                  ]}>
                  <TText variant="bodySm" weight="semibold" style={{ color: on ? colors.textOnBrand : colors.textBody }}>
                    {sv.name}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {needService ? (
        <TText variant="bodySm" color="textMuted">
          {t.customers.due.pickService}
        </TText>
      ) : (
        // Keyed on the services: a different visit length is a different set of free times.
        <SlotPickerInline
          key={services.join(',')}
          fetchSlots={(d, st) => api.getNewBookingSlots(d, services, st)}
          initialDate={opening}
          staffOptions={options}
          staffValue={staff}
          onStaffChange={setStaff}
          value={slot}
          onChange={setSlot}
          closedWeekdays={closedWeekdaysOf(store.business?.hours)}
          reloadToken={reload}
        />
      )}
      {slot ? (
        <View style={s.confirm}>
          <TText variant="bodySm" color="textStrong" weight="semibold">
            {format(t.customers.due.bookConfirm, { when: slotWhen(slot.date, slot.label) })}
          </TText>
          <TText variant="caption" color="textMuted">
            {t.customers.due.noText}
          </TText>
          <View style={s.buttons}>
            <TButton size="sm" loading={busy} onPress={() => void confirm(slot)}>
              {t.customers.due.bookYes}
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
  services: { gap: moderateScale(6) },
  chip: {
    borderWidth: moderateScale(1),
    borderRadius: moderateScale(999),
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
  },
  confirm: { gap: moderateScale(6) },
  buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8), marginTop: moderateScale(2) },
});
