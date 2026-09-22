import React, { forwardRef } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export const TScreenScroll = forwardRef<ScrollView, {
  children: React.ReactNode;
  /** When `onRefresh` is provided, adds pull-to-refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Let the content fill the screen, so a `TEmptyState fill` can centre in it. Set while empty. */
  grow?: boolean;
}>(function TScreenScroll({ children, refreshing, onRefresh, grow = false }, ref) {
  const { colors } = useTheme();
  return (
    <ScrollView
      ref={ref}
      style={styles.flex}
      contentContainerStyle={[styles.screenPadding, styles.pb6, grow && growStyle]}
      showsVerticalScrollIndicator={false}
      // Same pair TKeyboardScreen already uses. "handled" makes a button under the keyboard
      // take one tap instead of two (the first was being spent dismissing), and on-drag gives
      // iOS a way to dismiss a number-pad, which has no Return key and no Back button.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  );
});

const growStyle = { flexGrow: 1 };
