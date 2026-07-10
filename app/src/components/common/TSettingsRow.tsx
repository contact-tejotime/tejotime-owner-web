import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon, IconName } from '@/components/ui/Icon';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export function TSettingsRow({
  icon,
  label,
  sub,
  onPress,
  trailing,
  destructive = false,
  showBorder = true,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  destructive?: boolean;
  showBorder?: boolean;
}) {
  const theme = useTheme();
  const s = useMemo(() => createTSettingsRowStyles(theme), [theme]);

  return (
    <Pressable onPress={onPress} disabled={!onPress && !trailing} style={settingsRowStyle(s, showBorder, !!sub)}>
      <View style={s.iconWrap}>
        <Icon name={icon} size={18} color={destructive ? theme.colors.error : theme.colors.textBody} />
      </View>
      <View style={s.body}>
        <TText variant="bodyMd" color={destructive ? 'error' : 'textStrong'} weight="medium">
          {label}
        </TText>
        {sub && (
          <TText variant="caption" color="textMuted" numberOfLines={1} style={s.sub}>
            {sub}
          </TText>
        )}
      </View>
      {trailing ?? (onPress ? <Icon name="chevronRight" size={18} color={theme.colors.textSubtle} /> : null)}
    </Pressable>
  );
}

const createTSettingsRowStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    row: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      paddingVertical: moderateScale(15),
      ...styles.ph4,
    },
    rowBorder: {
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    iconWrap: {
      ...styles.nonFlexCenter,
      width: moderateScale(34),
      height: moderateScale(34),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceSunken,
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    sub: { marginTop: moderateScale(3) },
    rowWithSub: { paddingVertical: moderateScale(12) },
  });

const settingsRowStyle = (
  s: ReturnType<typeof createTSettingsRowStyles>,
  showBorder: boolean,
  hasSub: boolean,
) => [s.row, hasSub ? s.rowWithSub : null, showBorder ? s.rowBorder : null];
