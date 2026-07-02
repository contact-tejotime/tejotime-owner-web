import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/BottomNav';
import { AddWalkInSheet } from '@/components/feedback/AddWalkInSheet';
import { DetailPanel } from '@/components/feedback/DetailPanel';
import { QRSheet } from '@/components/feedback/QRSheet';
import { Toast } from '@/components/feedback/Toast';
import { Appointments } from '@/screens/Appointments';
import { Customers } from '@/screens/Customers';
import { Dashboard } from '@/screens/Dashboard';
import { Login } from '@/screens/Login';
import { Queue } from '@/screens/Queue';
import { Settings } from '@/screens/Settings';
import { AppStateProvider, TabId, useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

const SCREENS: Record<TabId, React.ReactNode> = {
  dashboard: <Dashboard />,
  queue: <Queue />,
  appointments: <Appointments />,
  customers: <Customers />,
  settings: <Settings />,
};

function Shell() {
  const { dark, colors } = useTheme();
  const store = useAppState();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {!store.authed ? (
          <Login />
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}>{SCREENS[store.tab]}</View>
            <BottomNav tab={store.tab} setTab={store.setTab} />
          </View>
        )}
      </SafeAreaView>

      <AddWalkInSheet />
      <QRSheet />
      <DetailPanel />
      <Toast />
    </View>
  );
}

export function OwnerApp() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
