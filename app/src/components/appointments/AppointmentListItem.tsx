import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TFormattedDate, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { t } from '@/i18n';
import { AppointmentEntry } from '@/data/sample';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

// Only an appointment still waiting to arrive can be checked into the queue —
// once it's checked in / finished / cancelled / no-showed, show its status instead.
const CHECK_IN_ELIGIBLE = new Set(['upcoming', 'confirmed']);

export function AppointmentListItem({
  appointment,
  staffName,
  checkInLoading,
  onCheckIn,
}: {
  appointment: AppointmentEntry;
  staffName?: string | null;
  checkInLoading: boolean;
  onCheckIn: (a: AppointmentEntry) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createAppointmentListItemStyles(theme), [theme]);
  const checkInEligible = CHECK_IN_ELIGIBLE.has(appointment.status);
  const serviceLine = staffName ? `${appointment.service} · ${staffName}` : appointment.service;

  return (
    <View style={s.row}>
      <TFormattedDate value={appointment.time} variant="bodySm" color="textMuted" weight="semibold" style={s.time} />
      <View style={s.card}>
        <View style={s.body}>
          <View style={s.nameRow}>
            <TText variant="bodyMd" color="textStrong" weight="semibold" style={s.nameText}>
              {appointment.name}
            </TText>
            {appointment.visitorType && (
              <Badge tone={appointment.visitorType === 'mr' ? 'info' : 'secondary'} size="sm">
                {appointment.visitorType === 'mr' ? t.queue.mr : t.queue.patient}
              </Badge>
            )}
          </View>
          <TText variant="caption" color="textMuted" style={s.service}>
            {serviceLine}
          </TText>
        </View>
        {checkInEligible ? (
          <TButton
            variant="ghost"
            size="sm"
            loading={checkInLoading}
            onPress={() => onCheckIn(appointment)}
            textColor={theme.colors.primary}>
            {t.appointments.addToQueue}
          </TButton>
        ) : (
          <StatusBadge status={appointment.status} />
        )}
      </View>
    </View>
  );
}

const createAppointmentListItemStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
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
    nameRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(6) },
    nameText: { flexShrink: 1 },
    service: { ...styles.mt1 },
  });
