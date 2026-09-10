import { Image } from "expo-image";
import React, { useEffect, useMemo, useState } from "react";
import { Keyboard, Linking, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
import { WEB_BASE_URL } from "@/lib/config";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from "@/lib/phone";
import { useAppState } from "@/state/store";
import { styles } from "@/styles";
import { moderateScale, verticalScale } from "@/styles/scale";
import type { ThemeStyleProps } from "@/styles/types";
import { useTheme } from "@/theme/ThemeProvider";

// The wordmark and tagline are near-black navy, so on a dark page they disappear while the orange
// "Time" keeps shining — the logo reads as half-missing. `logo-full-dark.png` lifts only that navy
// to gray50 and leaves the orange and the blue calendar tile untouched; regenerate it with
// `python3 scripts/make-dark-logo.py assets/images/logo-full.png assets/images/logo-full-dark.png`
// if the brand asset ever changes.
const logoLight = require("@/assets/images/logo-full.png");
const logoDark = require("@/assets/images/logo-full-dark.png");

// The legal pages live on the customer web app (`frontend/src/app/{terms,privacy}`), not in the
// mobile app. `WEB_BASE_URL` can carry a trailing slash from the env var, so trim it the same way
// `settings/appearance.tsx` does before appending a path.
const legalUrl = (page: string) => `${WEB_BASE_URL.replace(/\/+$/, "")}/${page}`;

function openTerms() {
  void Linking.openURL(legalUrl("terms"));
}

function openPrivacy() {
  void Linking.openURL(legalUrl("privacy"));
}

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
    // Login is not under the tabs shell, so it carries its own insets. All four
    // edges: in landscape on a tablet the notch is on a side, not the top.
    <SafeAreaView style={styles.flex} edges={["top", "bottom", "left", "right"]}>
      <TKeyboardScreen contentContainerStyle={s.content}>
        <View style={[s.body, centerStyle, keyboardOpen && s.bodyKeyboard]}>
          <Image
            source={theme.dark ? logoDark : logoLight}
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
          {/* Split across two rows so the links are a line of their own rather than two blue words
              buried mid-sentence — at 12px an inline link is a hard target to hit accurately. */}
          <View style={s.legal}>
            <TText variant="caption" color="textSubtle" align="center">
              {t.auth.terms}
            </TText>
            <TText variant="caption" color="textSubtle" align="center">
              <TText
                variant="caption"
                color="primary"
                weight="semibold"
                accessibilityRole="link"
                suppressHighlighting
                onPress={openTerms}>
                {t.auth.termsLink}
              </TText>
              {" & "}
              <TText
                variant="caption"
                color="primary"
                weight="semibold"
                accessibilityRole="link"
                suppressHighlighting
                onPress={openPrivacy}>
                {t.auth.privacyLink}
              </TText>
            </TText>
          </View>
        </View>
      </TKeyboardScreen>
    </SafeAreaView>
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
      ...styles.g3,
    },
    // Tighter than the footer gap on purpose: the two legal rows are one sentence, so they have to
    // read as a pair rather than as another entry in the footer's stack.
    legal: {
      ...styles.g1,
    },
  });
