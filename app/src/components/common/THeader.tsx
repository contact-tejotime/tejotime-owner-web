import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { StoreMark } from '@/components/ui/StoreMark';
import { styles } from '@/styles';
import { moderateScale, scaleFont } from '@/styles/scale';

export function THeader({
  title,
  subtitle,
  action,
  avatar = false,
  avatarName,
  avatarUrl,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Show the store's mark (see `StoreMark`) in front of the title. */
  avatar?: boolean;
  /** Initials source when `avatar` is true and there is no logo. Defaults to `title`. */
  avatarName?: string;
  /** The store's uploaded logo, shown in place of the initials when present. */
  avatarUrl?: string;
}) {
  return (
    <View style={theaderStyles.root}>
      {avatar && <StoreMark name={avatarName ?? title} logoUrl={avatarUrl} size={44} />}
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
