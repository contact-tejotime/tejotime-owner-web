import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

export function TScreenScroll({
  children,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  /** When `onRefresh` is provided, adds pull-to-refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
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
}
