import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { styles } from '@/styles';
import { moderateScale, scaleFont } from '@/styles/scale';

export function THeader({
  title,
  subtitle,
  action,
  avatar = false,
  avatarName,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  avatar?: boolean;
  /** Initials source when `avatar` is true. Defaults to `title`. */
  avatarName?: string;
}) {
  return (
    <View style={theaderStyles.root}>
      {avatar && <InitialsAvatar name={avatarName ?? title} size={40} />}
      <View style={theaderStyles.body}>
        <TText variant="h4" color="textStrong" weight="extrabold" style={theaderStyles.title}>
          {title}
        </TText>
        {subtitle ? (
          <TText variant="bodySm" color="textMuted">
            {subtitle}
          </TText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const theaderStyles = StyleSheet.create({
  root: {
    ...styles.flexRow,
    ...styles.itemsCenter,
    ...styles.g3,
    ...styles.ph5,
    paddingTop: moderateScale(16),
    paddingBottom: moderateScale(12),
  },
  body: { ...styles.flex, ...styles.minWidth0, gap: moderateScale(4) },
  title: { fontSize: scaleFont(22), letterSpacing: -0.4 },
});
