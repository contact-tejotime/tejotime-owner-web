import { Image } from 'expo-image';
import React from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

const logo = require('@/assets/images/logo-full.png');

export function Login() {
  const { colors, fontFamily, fontSize } = useTheme();
  const { userId, password, loginError, setUserId, setPassword, signIn } = useAppState();

  return (
    <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30 }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
        <Image source={logo} style={{ width: 280, height: 186, alignSelf: 'center' }} contentFit="contain" />

        <View style={{ gap: 16 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.h4, color: colors.textStrong }}>
              Welcome back
            </Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodyMd, color: colors.textMuted, marginTop: 4 }}>
              Sign in to manage your queue
            </Text>
          </View>
          <Input
            label="User ID"
            placeholder="sharpcuts"
            autoCapitalize="none"
            value={userId}
            onChangeText={setUserId}
          />
          <Input
            label="Password"
            placeholder="Enter your password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button variant="primary" size="lg" fullWidth onPress={signIn}>
            Sign in
          </Button>
          {!!loginError && (
            <Text style={{ textAlign: 'center', fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.error }}>
              {loginError}
            </Text>
          )}
        </View>
      </View>
      <Text style={{ textAlign: 'center', fontFamily: fontFamily.medium, fontSize: fontSize.caption, color: colors.textSubtle }}>
        By continuing you agree to our Terms & Privacy Policy
      </Text>
    </View>
  );
}
