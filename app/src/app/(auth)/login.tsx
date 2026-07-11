import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PhoneInput, TButton, TInput, TKeyboardScreen, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { useResponsive } from '@/hooks/useResponsive';
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from '@/lib/phone';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { getHeight, moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

const logo = require('@/assets/images/logo-full.png');

export default function Login() {
  const { colors } = useTheme();
  const { signInLoading, signIn } = useAppState();
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [iso2, setIso2] = useState(DEFAULT_ISO2);
  const [national, setNational] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { centerStyle } = useResponsive(440);

  return (
    <TKeyboardScreen contentContainerStyle={loginStyles.content}>
      <View style={[loginStyles.body, centerStyle]}>
        <Image source={logo} style={loginStyles.logo} contentFit="contain" />

        <View style={loginStyles.form}>
          <View style={loginStyles.titleBlock}>
            <TText variant="h4" color="textStrong" weight="semibold">
              Welcome back
            </TText>
            <TText variant="bodyMd" color="textMuted" style={loginStyles.welcomeSubtitle}>
              Sign in to manage your queue
            </TText>
          </View>
          <PhoneInput
            label="Phone number"
            placeholder="9399385943"
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
            label="Password"
            placeholder="Enter your password"
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
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} color={colors.textMuted} />
              </Pressable>
            }
          />
          <TButton
            variant="primary"
            size="lg"
            fullWidth
            loading={signInLoading}
            onPress={() => signIn(combineToDigits(dialCode, national), password)}>
            Sign in
          </TButton>
        </View>
      </View>
      <TText variant="caption" color="textSubtle" weight="medium" align="center">
        By continuing you agree to our Terms & Privacy Policy
      </TText>
    </TKeyboardScreen>
  );
}

const loginStyles = StyleSheet.create({
  content: {
    ...styles.ph6,
    ...styles.pt3,
    flexGrow: 1,
    paddingBottom: getHeight(30),
  },
  body: {
    ...styles.flex,
    ...styles.justifyCenter,
    ...styles.g6,
  },
  logo: {
    width: moderateScale(280),
    height: moderateScale(186),
    alignSelf: 'center',
  },
  form: {
    ...styles.g4,
  },
  titleBlock: {
    ...styles.itemsCenter,
  },
  welcomeSubtitle: {
    ...styles.mt1,
  },
});
