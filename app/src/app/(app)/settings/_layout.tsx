import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/styles';

export default function SettingsLayout() {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaView>
  );
}
