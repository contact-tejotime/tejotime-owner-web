import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export default function SettingsLayout() {
  const { colors } = useTheme();

  return (
    // `left`/`right` keep the back button and content clear of the notch when a
    // tablet is held in landscape; both are 0 in portrait. `bottom` is left off
    // deliberately — these pages scroll to the very bottom edge, and the scroll
    // view's own bottom padding already clears the home indicator.
    <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
      {/* contentStyle is required on EVERY navigator — see the note in the root layout. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }} />
    </SafeAreaView>
  );
}
