import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppointmentListItem } from '@/components/appointments/AppointmentListItem';
import { THeader, TScopeNotice, TScreenScroll, TSectionTitle, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { IconButton } from '@/components/ui/IconButton';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

export default function Appointments() {
  const theme = useTheme();
  const store = useAppState();
  const emptyStyles = useMemo(() => createEmptyStyles(theme), [theme]);

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
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TScopeNotice />
        <TSectionTitle>{t.appointments.upcomingToday}</TSectionTitle>
        <View style={styles.g2}>
          {store.appts.length === 0 ? (
            <View style={emptyStyles.box}>
              <TText variant="bodyMd" color="textStrong" weight="bold" align="center">
                {t.appointments.empty}
              </TText>
              <TText variant="bodySm" color="textMuted" align="center" style={styles.mt2}>
                {t.appointments.emptyHint}
              </TText>
            </View>
          ) : (
            store.appts.map((a) => (
              <AppointmentListItem
                key={a.id}
                appointment={a}
                staffName={a.staffId ? staffById[a.staffId] : undefined}
                checkInLoading={store.checkInId === a.id}
                onCheckIn={store.checkInAppt}
              />
            ))
          )}
        </View>
      </TScreenScroll>
    </>
  );
}

const createEmptyStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    box: {
      marginTop: moderateScale(12),
      paddingVertical: moderateScale(28),
      paddingHorizontal: moderateScale(20),
      borderWidth: moderateScale(1),
      borderStyle: 'dashed',
      borderColor: colors.borderDefault,
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.surfaceCard,
    },
  });
