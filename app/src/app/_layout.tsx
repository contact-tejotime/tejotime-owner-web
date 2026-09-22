import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { applyOrientationPolicy } from '@/lib/orientation';
import { AppStateProvider } from '@/state/store';
import { TAnimatedSplash, TSplashScreen, TToast } from '@/components/common';
import { NATIVE_SPLASH_FADE_MS } from '@/components/common/TSplashScreen';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

import '../global.css';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: NATIVE_SPLASH_FADE_MS, fade: false });

/**
 * Every navigator needs `contentStyle`, because React Navigation paints its OWN opaque scene
 * background over whatever themed surface sits behind it. Nothing in this app installs
 * `@react-navigation/native`'s ThemeProvider (the package isn't even a direct dependency), so it
 * falls back to its default light theme — a flat `rgb(242,242,242)`.
 *
 * In light mode that grey is close enough to `surfacePage` that nobody noticed. In dark mode it
 * stayed light while every card went dark, and the near-white `textStrong` headings painted onto
 * it vanished completely. Screens themselves were never at fault — they were being covered.
 *
 * Split out from RootLayout because it has to read the theme, and RootLayout is what renders the
 * provider.
 */
function RootNavigator() {
  const { colors } = useTheme();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    'PlusJakartaSans-ExtraLight': require('../../assets/fonts/PlusJakartaSans-ExtraLight.ttf'),
    'PlusJakartaSans-ExtraLightItalic': require('../../assets/fonts/PlusJakartaSans-ExtraLightItalic.ttf'),
    'PlusJakartaSans-Light': require('../../assets/fonts/PlusJakartaSans-Light.ttf'),
    'PlusJakartaSans-LightItalic': require('../../assets/fonts/PlusJakartaSans-LightItalic.ttf'),
    'PlusJakartaSans-Regular': require('../../assets/fonts/PlusJakartaSans-Regular.ttf'),
    'PlusJakartaSans-Italic': require('../../assets/fonts/PlusJakartaSans-Italic.ttf'),
    'PlusJakartaSans-Medium': require('../../assets/fonts/PlusJakartaSans-Medium.ttf'),
    'PlusJakartaSans-MediumItalic': require('../../assets/fonts/PlusJakartaSans-MediumItalic.ttf'),
    'PlusJakartaSans-SemiBold': require('../../assets/fonts/PlusJakartaSans-SemiBold.ttf'),
    'PlusJakartaSans-SemiBoldItalic': require('../../assets/fonts/PlusJakartaSans-SemiBoldItalic.ttf'),
    'PlusJakartaSans-Bold': require('../../assets/fonts/PlusJakartaSans-Bold.ttf'),
    'PlusJakartaSans-BoldItalic': require('../../assets/fonts/PlusJakartaSans-BoldItalic.ttf'),
    'PlusJakartaSans-ExtraBold': require('../../assets/fonts/PlusJakartaSans-ExtraBold.ttf'),
    'PlusJakartaSans-ExtraBoldItalic': require('../../assets/fonts/PlusJakartaSans-ExtraBoldItalic.ttf'),
  });

  // Tablets rotate, phones stay portrait. Fire-and-forget: a device that refuses
  // the request (an Android OEM that pins orientation system-wide) should not
  // take the app down with an unhandled rejection.
  useEffect(() => {
    void applyOrientationPolicy().catch(() => {});
  }, []);

  // The native splash stays up until TAnimatedSplash has drawn its identical first frame, and
  // TAnimatedSplash hides it then. This static copy only ever sits underneath the native splash.
  if (!loaded) return <TSplashScreen />;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppStateProvider>
            <RootNavigator />
            <TToast />
            {/* Last, so it covers the navigator and any early toast until it has played. */}
            <TAnimatedSplash />
          </AppStateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
