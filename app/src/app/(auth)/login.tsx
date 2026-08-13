import { Image } from "expo-image";
import React, { useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";

import {
  PhoneInput,
  TButton,
  TInput,
  TKeyboardScreen,
  TText,
  SupportContact,
} from "@/components/common";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
import { useResponsive } from "@/hooks/useResponsive";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from "@/lib/phone";
import { useAppState } from "@/state/store";
import { styles } from "@/styles";
import { moderateScale, verticalScale } from "@/styles/scale";
import type { ThemeStyleProps } from "@/styles/types";
import { useTheme } from "@/theme/ThemeProvider";

const logo = require("@/assets/images/logo-full.png");

export default function Login() {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createLoginStyles(theme), [theme]);
  const { signInLoading, signIn } = useAppState();
  // The Owner/Staff switch. A guard rail, not a second credential — the password still decides
  // everything. Its job is to turn a confusing "invalid credentials" into "that's an owner
  // login, pick Owner", which is the mistake people make once a shop has both kinds.
  const [accountType, setAccountType] = useState<"owner" | "staff">("owner");
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [iso2, setIso2] = useState(DEFAULT_ISO2);
  const [national, setNational] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const { centerStyle } = useResponsive(440);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <TKeyboardScreen contentContainerStyle={s.content}>
      <View style={[s.body, centerStyle, keyboardOpen && s.bodyKeyboard]}>
        <Image
          source={logo}
          style={[s.logo, keyboardOpen && s.logoKeyboard]}
          contentFit="contain"
        />

        <View style={s.card}>
          <View style={s.titleBlock}>
            <TText variant="h5" color="textStrong" weight="semibold">
              {accountType === "owner" ? t.auth.ownerTitle : t.auth.staffTitle}
            </TText>
            <TText
              variant="bodySm"
              color="textMuted"
              align="center"
              style={s.subtitle}
            >
              {accountType === "owner"
                ? t.auth.ownerSubtitle
                : t.auth.staffSubtitle}
            </TText>
          </View>

          <View style={s.segmented} accessibilityRole="tablist">
            {(["owner", "staff"] as const).map((type) => {
              const active = accountType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setAccountType(type)}
                  disabled={signInLoading}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[s.segmentedBtn, active && s.segmentedBtnActive]}
                >
                  <TText
                    variant="bodySm"
                    weight={active ? "semibold" : "medium"}
                    color={active ? "primary" : "textMuted"}
                  >
                    {type === "owner" ? t.auth.owner : t.auth.staff}
                  </TText>
                </Pressable>
              );
            })}
          </View>

          <View style={s.fields}>
            <PhoneInput
              label={t.auth.phoneLabel}
              placeholder={t.auth.phonePlaceholder}
              dialCode={dialCode}
              iso2={iso2}
              national={national}
              onChangeCountry={(c) => {
                setDialCode(c.dialCode);
                setIso2(c.iso2);
              }}
              onChangeNational={setNational}
              editable={!signInLoading}
            />
            <TInput
              label={t.auth.passwordLabel}
              placeholder={t.auth.passwordPlaceholder}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!signInLoading}
              trailingIcon={
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  disabled={signInLoading}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? t.auth.hidePassword : t.auth.showPassword
                  }
                >
                  <Icon
                    name={showPassword ? "eyeOff" : "eye"}
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              }
            />
          </View>

          <TButton
            variant="primary"
            size="lg"
            fullWidth
            loading={signInLoading}
            onPress={() =>
              signIn(combineToDigits(dialCode, national), password, accountType)
            }
          >
            {t.auth.signIn}
          </TButton>

          {accountType === "staff" ? (
            <TText variant="caption" color="textSubtle" align="center">
              {t.auth.staffFoot}
            </TText>
          ) : null}
        </View>
      </View>

      <View style={s.footer}>
        <SupportContact variant="login" />
        <TText variant="caption" color="textSubtle" align="center">
          {t.auth.terms}
        </TText>
      </View>
    </TKeyboardScreen>
  );
}

const createLoginStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    content: {
      ...styles.ph5,
      flexGrow: 1,
      paddingTop: verticalScale(24),
      paddingBottom: verticalScale(20),
    },
    body: {
      flexGrow: 1,
      ...styles.justifyCenter,
      gap: verticalScale(24),
    },
    bodyKeyboard: {
      flexGrow: 0,
      justifyContent: "flex-start",
      gap: verticalScale(16),
    },
    logo: {
      width: moderateScale(230),
      height: moderateScale(66),
      alignSelf: "center",
    },
    logoKeyboard: {
      width: moderateScale(170),
      height: moderateScale(49),
    },
    card: {
      ...styles.g4,
      backgroundColor: colors.surfaceCard,
      borderRadius: moderateScale(radius.xl),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      paddingHorizontal: moderateScale(20),
      paddingVertical: moderateScale(24),
      ...shadow.md,
    },
    titleBlock: {
      ...styles.itemsCenter,
    },
    subtitle: {
      ...styles.mt1,
      paddingHorizontal: moderateScale(4),
    },
    segmented: {
      ...styles.flexRow,
      backgroundColor: colors.surfaceSunken,
      borderRadius: moderateScale(radius.md),
      padding: moderateScale(4),
      gap: moderateScale(4),
    },
    segmentedBtn: {
      ...styles.flex,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      height: moderateScale(38),
      borderRadius: moderateScale(radius.sm),
    },
    segmentedBtnActive: {
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      ...shadow.xs,
    },
    fields: {
      ...styles.g4,
      ...styles.mt1,
    },
    // No top margin: the body flexes to fill, so the slack above the logo and below the card stays
    // symmetric and the footer's own divider does the separating.
    footer: {
      ...styles.g2,
    },
  });
