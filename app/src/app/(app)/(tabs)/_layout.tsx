import { Slot } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/BottomNav';
import { TResponsiveContainer } from '@/components/common';
import { styles } from '@/styles';

export default function TabsLayout() {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.flex}>
        {/* Centered max-width column on tablets; full-bleed on phones. */}
        <TResponsiveContainer maxWidth={720}>
          <Slot />
        </TResponsiveContainer>
        <BottomNav />
      </View>
    </SafeAreaView>
  );
}
