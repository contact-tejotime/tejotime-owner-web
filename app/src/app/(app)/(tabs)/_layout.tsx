import { Slot } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/BottomNav';
import { styles } from '@/styles';

export default function TabsLayout() {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.flex}>
        <View style={styles.flex}>
          <Slot />
        </View>
        <BottomNav />
      </View>
    </SafeAreaView>
  );
}
