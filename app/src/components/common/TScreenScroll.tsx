import React, { forwardRef } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export const TScreenScroll = forwardRef<ScrollView, {
  children: React.ReactNode;
  /** When `onRefresh` is provided, adds pull-to-refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
}>(function TScreenScroll({ children, refreshing, onRefresh }, ref) {
  const { colors } = useTheme();
  return (
    <ScrollView
      ref={ref}
      style={styles.flex}
      contentContainerStyle={[styles.screenPadding, styles.pb6]}
      showsVerticalScrollIndicator={false}
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
