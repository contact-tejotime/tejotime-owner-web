import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TScreenScroll, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

/** Full-screen settings sub-page: back chevron + title header above a scroll body. */
export function SettingsPageShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();

  return (
    <View style={styles.flex}>
      <View style={shellStyles.header}>
        <IconButton variant="ghost" onPress={() => router.back()} accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.textStrong} />
        </IconButton>
        <TText variant="h5" color="textStrong" weight="bold">
          {title}
        </TText>
      </View>
      <TScreenScroll>{children}</TScreenScroll>
    </View>
  );
}

const shellStyles = StyleSheet.create({
  header: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g2, ...styles.ph3, ...styles.pt1, ...styles.pb3 },
});
