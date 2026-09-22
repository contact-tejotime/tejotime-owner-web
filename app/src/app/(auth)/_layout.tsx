import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { TSplashScreen } from '@/components/common';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  const { authed, authLoading } = useAppState();
  const { colors, dark } = useTheme();

  // The launch screen, continued — see TSplashScreen for why every launch wait draws it.
  if (authLoading) return <TSplashScreen />;
  if (authed) return <Redirect href="/(app)/(tabs)/dashboard" />;

  return (
    <>
      {/* Without this, Android drew the status bar's clock and icons white on the light onboarding and
          sign-in pages, where they all but disappeared. The (app) layout has always set its own. */}
      <StatusBar style={dark ? 'light' : 'dark'} />
      {/* contentStyle is required on EVERY navigator — see the note in the root layout. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }}>
        <Stack.Screen name="onboarding" />
        {/* A fade, not the default slide: the tour hands over to sign-in rather than pushing it. */}
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}
