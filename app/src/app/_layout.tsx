import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider } from '@/state/store';
import { TSplashScreen, TToast } from '@/components/common';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { styles } from '@/styles';

import '../global.css';

SplashScreen.preventAutoHideAsync();

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

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return <TSplashScreen />;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppStateProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
            <TToast />
          </AppStateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
