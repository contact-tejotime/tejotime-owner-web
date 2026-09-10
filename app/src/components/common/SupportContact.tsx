import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { t } from '@/i18n';
import { SUPPORT } from '@/lib/support';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

type Variant = 'block' | 'login' | 'strip';

function openMail() {
  void Linking.openURL(`mailto:${SUPPORT.email}`);
}

function openTel() {
  void Linking.openURL(`tel:${SUPPORT.phoneTel}`);
}

/**
 * TejoTime support contact — mailto / tel via system handlers.
 * `strip` sits above the tab bar; `block` / `login` are fuller cards.
 */
export function SupportContact({ variant = 'block' }: { variant?: Variant }) {
  const theme = useTheme();
  const s = useMemo(() => createSupportStyles(theme), [theme]);

  if (variant === 'strip') {
    return (
      <View style={s.strip} accessibilityRole="summary">
        <TText variant="caption" color="textMuted">
          {t.support.needHelp}
        </TText>
        <Pressable onPress={openMail} hitSlop={8}>
          <TText variant="caption" color="primary" weight="semibold">
            {t.support.email}
          </TText>
        </Pressable>
        <TText variant="caption" color="textMuted">
          ·
        </TText>
        <Pressable onPress={openTel} hitSlop={8}>
          <TText variant="caption" color="primary" weight="semibold">
            {t.support.call}
          </TText>
        </Pressable>
      </View>
    );
  }

  // `login` drops the heading and blurb — an email address and a phone number read as support on
  // their own, and anything more turns the footer into a second block competing with the form.
  //
  // Deliberately muted rather than the primary blue the other variants use: on the sign-in screen
  // this sits directly under the Sign in button, and two bold blue links there pull the eye past
  // the one control that matters. The legal links below are the only blue in the footer, so the
  // colour still means "tappable" — these stay a shade darker than the `·` to keep the affordance.
  if (variant === 'login') {
    return (
      <View style={s.login}>
        <Pressable onPress={openMail} hitSlop={8}>
          <TText variant="caption" color="textMuted">
            {SUPPORT.email}
          </TText>
        </Pressable>
        <TText variant="caption" color="textSubtle">
          ·
        </TText>
        <Pressable onPress={openTel} hitSlop={8}>
          <TText variant="caption" color="textMuted">
            {SUPPORT.phoneDisplay}
          </TText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.block}>
      <TText variant="bodySm" color="textStrong" weight="bold">
        {t.support.needHelp}
      </TText>
      <TText variant="caption" color="textMuted" style={s.blurb}>
        {t.settings.supportBlurb}
      </TText>
      <View style={s.links}>
        <Pressable onPress={openMail}>
          <TText variant="bodySm" color="primary" weight="semibold">
            {SUPPORT.email}
          </TText>
        </Pressable>
        <Pressable onPress={openTel}>
          <TText variant="bodySm" color="primary" weight="semibold">
            {SUPPORT.phoneDisplay}
          </TText>
        </Pressable>
      </View>
      <View style={s.address}>
        {SUPPORT.addressLines.map((line) => (
          <TText key={line} variant="caption" color="textMuted">
            {line}
          </TText>
        ))}
      </View>
    </View>
  );
}

const createSupportStyles = ({ colors }: ThemeStyleProps) =>
  StyleSheet.create({
    strip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      gap: moderateScale(6),
      paddingVertical: moderateScale(6),
      paddingHorizontal: moderateScale(12),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.surfaceCard,
    },
    block: {
      gap: moderateScale(4),
    },
    login: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      flexWrap: 'wrap',
      gap: moderateScale(8),
      paddingTop: moderateScale(16),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
    },
    blurb: {
      marginBottom: moderateScale(4),
    },
    links: {
      gap: moderateScale(6),
      marginTop: moderateScale(4),
    },
    address: {
      marginTop: moderateScale(8),
    },
  });
