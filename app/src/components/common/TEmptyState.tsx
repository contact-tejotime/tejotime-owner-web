import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The one way the app says "nothing here": an icon in a soft brand disc, the message, and an
 * optional hint, all centred.
 *
 * Empty messages used to be a line of muted text pinned to the top-left of wherever the list would
 * have been ("No customers yet" under the search bar, "No services yet" above an empty card), which
 * read like leftover text rather than a state. Owners asked for them in the middle.
 *
 * - `fill`: take the remaining height and centre in it. The parent must let it grow: a ScrollView
 *   or FlatList needs `flexGrow: 1` on its content container while empty (`TScreenScroll` has a
 *   `grow` prop for exactly this).
 * - `compact`: a smaller version for an empty *section* inside a screen or a sheet (a Reports list,
 *   the day sheet, the country picker), centred in that section.
 */
export function TEmptyState({
  icon,
  title,
  hint,
  fill = false,
  compact = false,
  style,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  fill?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const disc = moderateScale(compact ? 44 : 56);

  return (
    <View style={[s.root, compact ? s.compact : s.regular, fill && s.fill, style]}>
      <View style={[s.disc, { width: disc, height: disc, borderRadius: disc / 2, backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={compact ? 20 : 24} color={colors.primary} />
      </View>
      <TText variant={compact ? 'bodySm' : 'bodyMd'} color="textMuted" weight="semibold" align="center" style={s.text}>
        {title}
      </TText>
      {hint ? (
        <TText variant="bodySm" color="textSubtle" align="center" style={s.text}>
          {hint}
        </TText>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { ...styles.itemsCenter, ...styles.justifyCenter, paddingHorizontal: moderateScale(24) },
  regular: { gap: moderateScale(10), paddingVertical: moderateScale(32) },
  compact: { gap: moderateScale(8), paddingVertical: moderateScale(20) },
  // Nudged up a little: dead-centre in the space under a header and above a tab bar reads as
  // slightly low.
  fill: { flex: 1, paddingBottom: moderateScale(56) },
  disc: { ...styles.itemsCenter, ...styles.justifyCenter, marginBottom: moderateScale(2) },
  text: { maxWidth: moderateScale(300) },
});
