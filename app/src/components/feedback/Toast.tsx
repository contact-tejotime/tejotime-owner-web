import React from 'react';
import { Modal, Text, View } from 'react-native';

import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export function Toast() {
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  const { toast } = useAppState();

  return (
    <Modal transparent visible={!!toast} animationType="fade" pointerEvents="box-none">
      <View pointerEvents="none" style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 }}>
        <View
          style={[
            {
              backgroundColor: colors.textStrong,
              borderRadius: radius.pill,
              paddingVertical: 12,
              paddingHorizontal: 18,
            },
            shadow.lg,
          ]}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.surfaceCard }}>
            {toast}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
