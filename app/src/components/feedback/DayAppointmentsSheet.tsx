import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppointmentListItem } from '@/components/appointments/AppointmentListItem';
import { TText } from '@/components/common';
import { useResponsive } from '@/hooks/useResponsive';
import { t } from '@/i18n';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

import { createSheetOverlayStyles } from './QRSheet';

/** Parse a local `YYYY-MM-DD` key back into a Date without any UTC shift. */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function DayAppointmentsSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();
  const { centerStyle } = useResponsive(520);
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createDayAppointmentsSheetStyles(theme, insets.bottom), [theme, insets.bottom]);

  const dateKey = store.dayApptsDate;
  const open = !!dateKey;

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    store.staff.forEach((st) => (map[st.id] = st.name));
    return map;
  }, [store.staff]);

  const dayAppts = useMemo(
    () => (dateKey ? store.calendarAppts.filter((a) => a.dateKey === dateKey) : []),
    [store.calendarAppts, dateKey],
  );

  const title = dateKey
    ? parseDateKey(dateKey).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={store.closeDayAppts}>
      <View style={overlay.root}>
        <Pressable onPress={store.closeDayAppts} style={overlay.backdrop} />
        <View style={[s.sheet, centerStyle]}>
          <View style={s.handle} />
          <TText variant="h4" weight="semibold" style={s.title}>
            {title}
          </TText>
          <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
            {dayAppts.length === 0 ? (
              <TText variant="bodySm" color="textMuted">
                {t.calendar.empty}
              </TText>
            ) : (
              <View style={styles.g2}>
                {dayAppts.map((a) => (
                  <AppointmentListItem
                    key={a.id}
                    appointment={a}
                    staffName={a.staffId ? staffById[a.staffId] : undefined}
                    checkInLoading={store.checkInId === a.id}
                    onCheckIn={store.checkInAppt}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createDayAppointmentsSheetStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(28) + bottomInset,
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
    list: { maxHeight: moderateScale(420) },
  });
