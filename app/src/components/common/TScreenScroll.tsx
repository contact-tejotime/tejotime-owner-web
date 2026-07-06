import React from 'react';
import { ScrollView } from 'react-native';

import { styles } from '@/styles';

export function TScreenScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.screenPadding, styles.pb6]}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}
