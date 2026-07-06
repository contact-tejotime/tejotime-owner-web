import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';

import { AddWalkInSheet } from '@/components/feedback/AddWalkInSheet';
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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <AddWalkInSheet />
      <QRSheet />
      <DetailPanel />
    </View>
  );
}
