import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TFormattedDate, THeader, TScreenScroll, TSectionTitle, TText } from '@/components/common';
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
  const s = useMemo(() => createAppointmentsStyles(theme), [theme]);

  return (
    <>
      <THeader
        title={t.appointments.title}
        subtitle="Thursday, 24 June"
        action={
          <IconButton variant="soft" accessibilityLabel={t.appointments.add} onPress={store.openWalkin}>
            <Icon name="plus" size={20} color={theme.colors.textBody} />
          </IconButton>
        }
      />
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TSectionTitle>{t.appointments.upcomingToday}</TSectionTitle>
        <View style={s.list}>
          {store.appts.length === 0 ? (
            <TText variant="bodySm" color="textMuted">
              {t.appointments.empty}
            </TText>
          ) : (
            store.appts.map((a) => (
              <View key={a.id} style={s.row}>
                <TFormattedDate value={a.time} variant="bodySm" color="textMuted" weight="semibold" style={s.time} />
                <View style={s.card}>
                  <View style={s.body}>
                    <TText variant="bodyMd" color="textStrong" weight="semibold">
                      {a.name}
                    </TText>
                    <TText variant="caption" color="textMuted" style={s.service}>
                      {a.service}
                    </TText>
                  </View>
                  <TButton
                    variant="ghost"
                    size="sm"
                    loading={store.checkInId === a.id}
                    onPress={() => store.checkInAppt(a)}
                    textColor={theme.colors.primary}>
                    {t.appointments.addToQueue}
                  </TButton>
                </View>
              </View>
            ))
          )}
        </View>
      </TScreenScroll>
    </>
  );
}

const createAppointmentsStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    list: { ...styles.g2 },
    row: { ...styles.flexRow, ...styles.g3 },
    time: {
      width: moderateScale(56),
      paddingTop: moderateScale(14),
      textAlign: 'right',
    },
    card: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      ...styles.flex,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderLeftWidth: moderateScale(3),
      borderLeftColor: colors.primary,
      borderRadius: moderateScale(radius.md),
      ...styles.pv3,
      ...styles.ph4,
      ...shadow.xs,
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    service: { ...styles.mt1 },
  });
