import React, { useMemo } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { createSheetOverlayStyles } from '@/components/feedback/QRSheet';
import { useResponsive } from '@/hooks/useResponsive';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/** Bottom-sheet shell for the settings edit forms (keyboard-aware). */
export function EditSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { centerStyle } = useResponsive(560);
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createEditSheetStyles(theme, insets.bottom), [theme, insets.bottom]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={overlay.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={onClose} style={overlay.backdrop} />
        <View style={[s.sheet, centerStyle]}>
          <View style={s.handle} />
          <TText variant="h4" weight="semibold" style={s.title}>
            {title}
          </TText>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createEditSheetStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(26) + bottomInset,
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    title: { ...styles.mb4 },
  });
