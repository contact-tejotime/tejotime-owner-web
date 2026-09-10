import { Slot } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNav } from '@/components/BottomNav';
import { SupportContact, TResponsiveContainer } from '@/components/common';
import { useTabContent } from '@/hooks/useResponsive';
import { styles } from '@/styles';

export default function TabsLayout() {
  // The cap widens one step at the `expanded` breakpoint — a single 720 looked
  // cramped on a 1194dp iPad in landscape. Both values are wider than any phone,
  // so the cap simply never engages in phone portrait.
  const { cap } = useTabContent();
  const insets = useSafeAreaInsets();

  return (
    // Only `top` here. The side insets are applied to the content column below
    // and inside BottomNav instead of on this SafeAreaView, because a
    // SafeAreaView pads its *background* too — in landscape that would leave a
    // strip of page colour down each side of the nav bar, which should read as
    // a full-bleed bar. Both are 0 in portrait, so phones are unaffected.
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.flex}>
        <View style={[styles.flex, { paddingLeft: insets.left, paddingRight: insets.right }]}>
          {/* Centered max-width column on wide screens; full-bleed on phones. */}
          <TResponsiveContainer maxWidth={cap}>
            <Slot />
          </TResponsiveContainer>
          <SupportContact variant="strip" />
        </View>
        <BottomNav />
      </View>
    </SafeAreaView>
  );
}
