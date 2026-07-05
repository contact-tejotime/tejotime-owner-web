import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { styles } from '@/styles';

export function TSectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={tSectionTitleStyles.root}>
      <TText variant="h5" color="textStrong">
        {children}
      </TText>
      {action}
    </View>
  );
}

const tSectionTitleStyles = StyleSheet.create({
  root: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, ...styles.mt5, ...styles.mb3 },
});
