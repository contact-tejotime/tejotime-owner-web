import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { business } from '@/data/sample';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';

export function THeader({
  title,
  subtitle,
  action,
  avatar = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  avatar?: boolean;
}) {
  return (
    <View style={theaderStyles.root}>
      {avatar && <InitialsAvatar name={business.name} size={40} />}
      <View style={theaderStyles.body}>
        <TText variant="h4" color="textStrong" weight="extrabold" style={theaderStyles.title}>
          {title}
        </TText>
        {subtitle && (
          <TText variant="bodySm" color="textMuted" style={theaderStyles.subtitle}>
            {subtitle}
          </TText>
        )}
      </View>
      {action}
    </View>
  );
}

const theaderStyles = StyleSheet.create({
  root: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3, ...styles.ph5, ...styles.pt2, ...styles.pb4 },
  body: { ...styles.flex, ...styles.minWidth0 },
  title: { fontSize: moderateScale(22), letterSpacing: -0.4 },
  subtitle: { ...styles.mt1 },
});
