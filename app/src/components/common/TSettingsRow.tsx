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
  const iconFg = destructive ? theme.colors.error : theme.colors.primarySoftFg;
  const iconBg = destructive ? theme.colors.errorSoft : theme.colors.primarySoft;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress && !trailing}
      style={({ pressed }) => [s.row, pressed && onPress ? s.rowPressed : null]}
    >
      <View style={[s.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={18} color={iconFg} />
      </View>
      <View style={[s.body, showBorder && s.bodyBorder]}>
        <View style={s.textCol}>
          <TText variant="bodyMd" color={destructive ? 'error' : 'textStrong'} weight="semibold">
            {label}
          </TText>
          {sub ? (
            <TText variant="caption" color="textMuted" numberOfLines={2} style={s.sub}>
              {sub}
            </TText>
          ) : null}
        </View>
        {trailing ??
          (onPress ? <Icon name="chevronRight" size={18} color={theme.colors.textSubtle} /> : null)}
      </View>
    </Pressable>
  );
}

const createTSettingsRowStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    row: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      paddingLeft: moderateScale(16),
      paddingRight: moderateScale(14),
      // Keep icon vertically centered against the text column.
      paddingVertical: moderateScale(4),
    },
    rowPressed: { backgroundColor: colors.surfaceHover },
    iconWrap: {
      ...styles.nonFlexCenter,
      width: moderateScale(38),
      height: moderateScale(38),
      borderRadius: moderateScale(radius.md),
      marginVertical: moderateScale(10),
    },
    body: {
      ...styles.flex,
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      ...styles.minWidth0,
      // Comfortable row height — label + optional sub without feeling cramped.
      paddingVertical: moderateScale(14),
      paddingRight: moderateScale(2),
      minHeight: moderateScale(58),
    },
    bodyBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    textCol: { ...styles.flex, ...styles.minWidth0, ...styles.g1 },
    sub: { marginTop: moderateScale(2) },
  });
