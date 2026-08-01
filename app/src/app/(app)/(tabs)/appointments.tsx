import React from 'react';
import { View } from 'react-native';

import { AppointmentListItem } from '@/components/appointments/AppointmentListItem';
import { THeader, TScreenScroll, TSectionTitle, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { IconButton } from '@/components/ui/IconButton';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

export default function Appointments() {
  const theme = useTheme();
  const store = useAppState();

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
        <View style={styles.g2}>
          {store.appts.length === 0 ? (
            <TText variant="bodySm" color="textMuted">
              {t.appointments.empty}
            </TText>
          ) : (
            store.appts.map((a) => (
              <AppointmentListItem
                key={a.id}
                appointment={a}
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
