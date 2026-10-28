import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { initialStaff, useStaffOptions } from '@/components/appointments/RescheduleInline';
import { closedWeekdaysOf, SlotPickerInline, type PickedSlot } from '@/components/appointments/SlotPickerInline';
import { ServiceCard } from '@/components/cards/ServiceCard';
import { PhoneInput, TSheet, TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { api } from '@/lib/api';
import { combineToE164, countryByDial, DEFAULT_DIAL_CODE, DEFAULT_ISO2, isValidNational } from '@/lib/phone';
import { storeTodayKey } from '@/lib/zoned';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

type VisitorType = 'mr' | 'patient';

/**
 * Book appointment — the Appointments tab's "+" (docs/owner-book-appointment.md). owner-web's twin
 * is `owner-web/src/components/NewAppointmentSheet.tsx`.
 *
 * The walk-in sheet's top half (name, phone, Hospital visitor type, the service list) and the
 * booking picker's bottom half (`SlotPickerInline`: day, stylist, a free time). The phone is
 * REQUIRED (owner, 2026-10-28): it links the visit to a customer record, and a number already on
 * the books is that customer. Nothing is booked until "Book appointment"; a time only highlights.
 *
 * Everything is INLINE in the one sheet — iOS will not present a second modal over an open one —
 * except PhoneInput's own country picker, which the walk-in sheet already ships with. A taken time
 * (409) re-reads the times. No SMS.
 */
export function BookAppointmentSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const open = store.sheet === 'book';
  const { centerStyle } = useResponsive(560);
  const s = useMemo(() => createStyles(theme, insets.bottom), [theme, insets.bottom]);
  const options = useStaffOptions();

  const storeCountry = store.business?.countryCode ? countryByDial(store.business.countryCode) : undefined;
  const firstServiceIds = () => (store.services[0] ? [store.services[0].id] : []);

  const [name, setName] = useState('');
  const [dialCode, setDialCode] = useState(storeCountry?.dialCode ?? DEFAULT_DIAL_CODE);
  const [iso2, setIso2] = useState(storeCountry?.iso2 ?? DEFAULT_ISO2);
  const [national, setNational] = useState('');
  const [visitorType, setVisitorType] = useState<VisitorType | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>(firstServiceIds);
  const [staff, setStaff] = useState<string | undefined>(() => initialStaff(null, options));
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [opening, setOpening] = useState(() => storeTodayKey());
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh fields on every open (the walk-in sheet's render-phase previous-value pattern — no
  // setState-in-effect painting the last customer for a frame).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setDialCode(storeCountry?.dialCode ?? DEFAULT_DIAL_CODE);
      setIso2(storeCountry?.iso2 ?? DEFAULT_ISO2);
      setNational('');
      setVisitorType(null);
      setServiceIds(firstServiceIds());
      setStaff(initialStaff(null, options));
      setSlot(null);
      setOpening(storeTodayKey());
      setError('');
    }
  }

  const needsVisitorType = store.business?.category === 'Hospital';
  // A store with services needs at least one: their length sets the free times.
  const needService = store.services.length > 0 && serviceIds.length === 0;
  const minutes = store.services.filter((sv) => serviceIds.includes(sv.id)).reduce((n, sv) => n + sv.durationMinutes, 0);

  const toggle = (id: string) => {
    setSlot(null);
    setError('');
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError(t.bookAppt.errName);
    if (!isValidNational(national, iso2)) return setError(t.bookAppt.errPhone);
    if (needsVisitorType && !visitorType) return setError(t.bookAppt.errVisitorType);
    if (needService) return setError(t.customers.due.pickService);
    if (!slot) return setError(t.bookAppt.errTime);
    setBusy(true);
    const ok = await store.bookAppointment({
      customerName: name.trim(),
      customerPhone: combineToE164(dialCode, national),
      serviceIds,
      slotStart: slot.startAt,
      staffId: staff,
      ...(visitorType ? { visitorType } : {}),
    });
    setBusy(false);
    if (!ok) {
      // Taken meanwhile (or refused): show what is free now.
      setSlot(null);
      setReload((r) => r + 1);
    }
  };

  return (
    <TSheet visible={open} onClose={store.closeBook} contentStyle={[s.sheet, centerStyle]} keyboardAvoiding>
      <View style={s.handle} />
      <TText variant="h4" weight="semibold" style={s.title}>
        {t.bookAppt.title}
      </TText>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Input
          label={t.walkin.nameLabel}
          placeholder={t.walkin.namePlaceholder}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError('');
          }}
          containerStyle={s.nameInput}
        />
        <PhoneInput
          label={t.walkin.phoneLabel}
          placeholder={t.walkin.phonePlaceholder}
          dialCode={dialCode}
          iso2={iso2}
          national={national}
          onChangeCountry={(c) => {
            setDialCode(c.dialCode);
            setIso2(c.iso2);
          }}
          onChangeNational={(v) => {
            setNational(v);
            setError('');
          }}
        />

        {needsVisitorType ? (
          <>
            <TText variant="bodySm" weight="medium" color="textBody" style={s.sectionLabel}>
              {t.walkin.visitorType}
            </TText>
            <View style={s.segmentWrap}>
              {(['mr', 'patient'] as const).map((v) => {
                const on = visitorType === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setVisitorType(v)}
                    style={s.segmentBtnStyle(on)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}>
                    <TText variant="bodySm" weight="semibold" style={s.segmentLabelStyle(on)}>
                      {v === 'mr' ? t.queue.mr : t.queue.patient}
                    </TText>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {store.services.length > 0 ? (
          <>
            <TText variant="bodySm" weight="medium" color="textBody" style={s.sectionLabel}>
              {t.walkin.service}
            </TText>
            <View style={s.list}>
              {store.services.map((sv) => (
                <ServiceCard
                  key={sv.id}
                  name={sv.name}
                  duration={sv.duration}
                  price={sv.price}
                  color={resolveColor(sv.color)}
                  selected={serviceIds.includes(sv.id)}
                  multiSelect
                  onPress={() => toggle(sv.id)}
                />
              ))}
            </View>
            {serviceIds.length > 0 ? (
              <TText variant="bodySm" color="textMuted" style={s.sectionLabel}>
                {format(t.walkin.servicesSelected, { count: serviceIds.length, minutes })}
              </TText>
            ) : null}
          </>
        ) : null}

        <View style={s.picker}>
          {needService ? (
            <TText variant="bodySm" color="textMuted">
              {t.customers.due.pickService}
            </TText>
          ) : (
            // Keyed on the services: a different visit length is a different set of free times.
            <SlotPickerInline
              key={serviceIds.join(',')}
              fetchSlots={(d, st) => api.getNewBookingSlots(d, serviceIds, st)}
              initialDate={opening}
              staffOptions={options}
              staffValue={staff}
              onStaffChange={setStaff}
              value={slot}
              onChange={(next) => {
                setSlot(next);
                setError('');
              }}
              closedWeekdays={closedWeekdaysOf(store.business?.hours)}
              reloadToken={reload}
            />
          )}
        </View>
      </ScrollView>

      <View style={s.footer}>
        {error ? (
          <TText variant="bodySm" color="error" style={s.error}>
            {error}
          </TText>
        ) : null}
        <Button variant="primary" size="lg" fullWidth loading={busy} onPress={() => void submit()}>
          {t.bookAppt.submit}
        </Button>
        <TText variant="caption" color="textSubtle" style={s.hint}>
          {t.appointments.noText}
        </TText>
      </View>
    </TSheet>
  );
}

const createStyles = ({ colors, radius, shadow }: ThemeStyleProps, bottomInset: number) => {
  const base = StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(26) + bottomInset,
      maxHeight: '86%',
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    title: { ...styles.mb4 },
    nameInput: { ...styles.mb4 },
    sectionLabel: { marginTop: moderateScale(18), marginBottom: moderateScale(8) },
    list: { ...styles.g2 },
    picker: { marginTop: moderateScale(18) },
    segmentWrap: {
      ...styles.flexRow,
      gap: moderateScale(4),
      backgroundColor: colors.surfaceSunken,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(4),
    },
    segmentBtn: { ...styles.flex, alignItems: 'center', borderRadius: moderateScale(radius.md), paddingVertical: moderateScale(10) },
    segmentBtnOn: { backgroundColor: colors.surfaceCard, ...shadow.xs },
    segmentLabelOn: { color: colors.primary },
    segmentLabelOff: { color: colors.textMuted },
    error: { ...styles.mb2 },
    hint: { ...styles.mt2, textAlign: 'center' },
    footer: { ...styles.mt4 },
  });
  return {
    ...base,
    segmentBtnStyle: (on: boolean) => [base.segmentBtn, on ? base.segmentBtnOn : null],
    segmentLabelStyle: (on: boolean) => (on ? base.segmentLabelOn : base.segmentLabelOff) as TextStyle,
  };
};
