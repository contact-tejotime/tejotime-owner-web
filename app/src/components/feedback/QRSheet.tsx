import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export function QRSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createQRSheetStyles(theme, insets.bottom), [theme, insets.bottom]);

  return (
    <Modal transparent visible={store.qr} animationType="slide" onRequestClose={store.closeQr}>
      <View style={overlay.root}>
        <Pressable onPress={store.closeQr} style={overlay.backdrop} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <TText variant="h4" weight="semibold" align="center">
            Your booking QR
          </TText>
          <TText variant="bodySm" color="textMuted" align="center" style={s.subtitle}>
            Customers scan to join your queue
          </TText>
          <View style={s.qrBox}>
            <Icon name="qrCode" size={120} color={theme.colors.textSubtle} />
          </View>
          <TText variant="bodySm" color="textMuted" weight="medium" align="center" style={s.url}>
            tejotime.com/sharp-cuts
          </TText>
          <View style={s.actions}>
            <View style={s.actionCell}>
              <Button variant="outline" fullWidth onPress={store.closeQr}>
                Download
              </Button>
            </View>
            <View style={s.actionCell}>
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

export const createSheetOverlayStyles = () =>
  StyleSheet.create({
    root: { ...styles.flex, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' },
  });

const createQRSheetStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(28) + bottomInset,
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    subtitle: { ...styles.mt1 },
    qrBox: {
      width: moderateScale(200),
      height: moderateScale(200),
      alignSelf: 'center',
      ...styles.mv5,
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.surfaceSunken,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      ...styles.nonFlexCenter,
    },
    url: { ...styles.mb5 },
    actions: { ...styles.flexRow, gap: moderateScale(10) },
    actionCell: { ...styles.flex },
  });
