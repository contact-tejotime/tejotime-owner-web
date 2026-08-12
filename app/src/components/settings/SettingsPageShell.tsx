import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TKeyboardScreen, TResponsiveContainer, TScreenScroll, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/i18n';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Settings sub-page chrome — back control + centered title, matching the profile-style header.
 */
export function SettingsPageShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();

  return (
    <TResponsiveContainer>
      <TKeyboardScreen isScrollView={false} style={styles.flex}>
        <View style={shellStyles.header}>
          <IconButton variant="soft" onPress={() => router.back()} accessibilityLabel={t.common.back}>
            <Icon name="chevronLeft" size={22} color={colors.textStrong} />
          </IconButton>
          <TText variant="h5" color="textStrong" weight="bold" style={shellStyles.title} numberOfLines={1}>
            {title}
          </TText>
          {/* Balance the back button so the title stays visually centered. */}
          <View style={shellStyles.headerSpacer} />
        </View>
        <TScreenScroll>{children}</TScreenScroll>
      </TKeyboardScreen>
    </TResponsiveContainer>
  );
}

const shellStyles = StyleSheet.create({
  header: {
    ...styles.flexRow,
    ...styles.itemsCenter,
    paddingHorizontal: moderateScale(12),
    paddingTop: moderateScale(6),
    paddingBottom: moderateScale(12),
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: moderateScale(40),
    height: moderateScale(40),
  },
});
