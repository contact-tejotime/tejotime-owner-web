import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";

import {
  PhoneInput,
  TButton,
  TInput,
  TKeyboardScreen,
  TText,
} from "@/components/common";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
import { useResponsive } from "@/hooks/useResponsive";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from "@/lib/phone";
import { useAppState } from "@/state/store";
import { styles } from "@/styles";
import { getHeight, moderateScale } from "@/styles/scale";
import { useTheme } from "@/theme/ThemeProvider";

const logo = require("@/assets/images/logo-full.png");

export default function Login() {
  const { colors } = useTheme();
  const { signInLoading, signIn } = useAppState();
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
    <TKeyboardScreen contentContainerStyle={loginStyles.content}>
      <View
        style={[
          loginStyles.body,
          centerStyle,
          keyboardOpen && loginStyles.bodyKeyboard,
        ]}
      >
        <Image
          source={logo}
          style={[loginStyles.logo, keyboardOpen && loginStyles.logoKeyboard]}
          contentFit="contain"
        />

        <View style={loginStyles.form}>
          <View style={loginStyles.titleBlock}>
            <TText variant="h4" color="textStrong" weight="semibold">
              {t.auth.welcomeBack}
            </TText>
            <TText
              variant="bodyMd"
              color="textMuted"
              style={loginStyles.welcomeSubtitle}
            >
              {t.auth.subtitle}
            </TText>
          </View>
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
          <TButton
            variant="primary"
            size="lg"
            fullWidth
            loading={signInLoading}
            onPress={() =>
              signIn(combineToDigits(dialCode, national), password)
            }
          >
            {t.auth.signIn}
          </TButton>
        </View>
      </View>
      <TText
        variant="caption"
        color="textSubtle"
        weight="medium"
        align="center"
      >
        {t.auth.terms}
      </TText>
    </TKeyboardScreen>
  );
}

const loginStyles = StyleSheet.create({
  content: {
    ...styles.ph6,
    ...styles.pt3,
    flexGrow: 1,
    paddingBottom: getHeight(16),
  },
  body: {
    flexGrow: 1,
    ...styles.justifyCenter,
    ...styles.g6,
  },
  bodyKeyboard: {
    flexGrow: 0,
    justifyContent: "flex-start",
    paddingTop: getHeight(12),
  },
  logo: {
    width: moderateScale(280),
    height: moderateScale(186),
    alignSelf: "center",
  },
  logoKeyboard: {
    width: moderateScale(200),
    height: moderateScale(133),
  },
  form: {
    ...styles.g4,
    marginTop: getHeight(-20),
  },
  titleBlock: {
    ...styles.itemsCenter,
  },
  welcomeSubtitle: {
    ...styles.mt1,
  },
});
