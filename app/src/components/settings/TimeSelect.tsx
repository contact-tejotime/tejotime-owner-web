import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { createSheetOverlayStyles } from '@/components/feedback/QRSheet';
import { Icon } from '@/components/ui/Icon';
import { TIME_OPTIONS } from '@/lib/hours';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/** Compact dropdown chip for picking a time; opens a bottom-sheet list of TIME_OPTIONS. */
export function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createTimeSelectStyles(theme, insets.bottom), [theme, insets.bottom]);

  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={s.chip}>
        <TText variant="bodySm" color="textStrong" weight="medium">
          {value}
        </TText>
        <Icon name="chevronDown" size={14} color={theme.colors.textSubtle} />
      </Pressable>
      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={overlay.root}>
          <Pressable onPress={() => setOpen(false)} style={overlay.backdrop} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              {TIME_OPTIONS.map((t) => (
                <Pressable key={t} onPress={() => pick(t)} style={s.option}>
                  <TText
                    variant="bodyMd"
                    color={t === value ? 'primary' : 'textStrong'}
                    weight={t === value ? 'semibold' : 'regular'}
                    style={styles.flex}>
                    {t}
                  </TText>
                  {t === value && <Icon name="check" size={18} color={theme.colors.primary} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createTimeSelectStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    chip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(4),
      backgroundColor: colors.surfacePage,
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
      borderRadius: moderateScale(radius.sm),
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(7),
    },
    sheet: {
      maxHeight: '60%',
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(16) + bottomInset,
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb3,
    },
    option: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      paddingVertical: moderateScale(12),
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
  });
