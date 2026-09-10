import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';

import { AddWalkInSheet } from '@/components/feedback/AddWalkInSheet';
import { DayAppointmentsSheet } from '@/components/feedback/DayAppointmentsSheet';
import { DetailPanel } from '@/components/feedback/DetailPanel';
import { QRSheet } from '@/components/feedback/QRSheet';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

export default function AppLayout() {
  const { authed, authLoading } = useAppState();
  const { dark, colors } = useTheme();

  if (authLoading) return null;
  if (!authed) return <Redirect href="/(auth)/login" />;

  return (
    <View style={[styles.flex, { backgroundColor: colors.surfacePage }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {/* The themed View above is not enough on its own — this navigator paints its own opaque
          scene background on top of it. See the note in the root layout. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <AddWalkInSheet />
      <QRSheet />
      <DetailPanel />
      <DayAppointmentsSheet />
    </View>
  );
}
