import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export function QRSheet() {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();

  return (
    <Modal transparent visible={store.qr} animationType="slide" onRequestClose={store.closeQr}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={store.closeQr} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
        <View
          style={{
            backgroundColor: colors.surfaceCard,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 28 + insets.bottom,
          }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: colors.borderDefault, alignSelf: 'center', marginBottom: 16 }} />
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.h4, color: colors.textStrong, textAlign: 'center' }}>
            Your booking QR
          </Text>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center', marginTop: 4 }}>
            Customers scan to join your queue
          </Text>
          <View
            style={{
              width: 200,
              height: 200,
              alignSelf: 'center',
              marginVertical: 20,
              borderRadius: radius.lg,
              backgroundColor: colors.surfaceSunken,
              borderWidth: 1,
              borderColor: colors.borderSubtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name="qrCode" size={120} color={colors.textSubtle} />
          </View>
          <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center', marginBottom: 18 }}>
            tejotime.com/sharp-cuts
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button variant="outline" fullWidth onPress={store.closeQr}>
                Download
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="primary" fullWidth onPress={store.closeQr}>
                Share
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
