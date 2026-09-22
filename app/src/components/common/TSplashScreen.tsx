import { Image } from 'expo-image';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { t } from '@/i18n';
import { moderateScale } from '@/styles/scale';
import { palette } from '@/theme/tokens';

export const splashMark = require('@/assets/images/splash-mark.png');

/**
 * The native splash's `imageWidth` in app.json, in pt/dp. **Change both together.** Every JS splash
 * frame starts from a mark exactly this size so that the OS → JS handover cannot be seen.
 */
export const NATIVE_MARK_SIZE = 150;

/**
 * How long the native splash takes to fade out once hidden (`SplashScreen.setOptions`, set in the
 * root layout). On Android that fade is real, 400 ms by default. The first cut of the animation
 * started moving the mark 120 ms in, so the native copy was still fading at the centre while the
 * JS copy slid left: a visible double image. The two frames are identical, so the fade buys
 * nothing. It is kept short, and the animation waits it out (see `TAnimatedSplash`).
 */
export const NATIVE_SPLASH_FADE_MS = 150;

/** The native splash's `backgroundColor`. Fixed: the splash sits outside ThemeProvider. */
export const SPLASH_BACKGROUND = '#FFFFFF';

/**
 * Nothing but the mark for this long. A warm launch finishes well inside it, so most starts show
 * no spinner at all, and a slow network doesn't leave the owner staring at a still screen.
 */
const SPINNER_DELAY_MS = 450;

/**
 * The native splash, redrawn in JS: the mark alone, centred, at the native size. It is the first
 * frame of `TAnimatedSplash`, and it covers the waits that happen before the animated splash can
 * mount: fonts loading (root layout), and restoring the session (`authLoading`) in the three layouts
 * that gate on it. The animated splash covers those while it runs.
 *
 * Colours are fixed (brand ink, white). It sits outside ThemeProvider, so it must never pick up a
 * store's primary colour.
 */
export function TSplashScreen() {
  return (
    <View style={splashStyles.root}>
      <Image source={splashMark} style={splashStyles.mark} contentFit="contain" accessibilityLabel={t.common.brand} />
      <Animated.View entering={FadeIn.delay(SPINNER_DELAY_MS).duration(300)} style={splashStyles.loader}>
        <ActivityIndicator size="small" color={palette.brandInk} />
      </Animated.View>
    </View>
  );
}

const splashStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SPLASH_BACKGROUND,
  },
  // Fixed points, NOT moderateScale: the native splash draws this image at exactly `imageWidth`.
  mark: { width: NATIVE_MARK_SIZE, height: NATIVE_MARK_SIZE },
  loader: {
    position: 'absolute',
    bottom: moderateScale(72),
  },
});
