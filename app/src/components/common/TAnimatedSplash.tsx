import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import geometry from '@/assets/images/splash-geometry.json';
import { t } from '@/i18n';
import { useAppState } from '@/state/store';
import { palette } from '@/theme/tokens';

import { NATIVE_MARK_SIZE, NATIVE_SPLASH_FADE_MS, SPLASH_BACKGROUND, splashMark } from './TSplashScreen';

const wordmark = require('@/assets/images/splash-wordmark.png');

/* Timeline, from the moment the native splash is hidden. */
/**
 * Let the OS → JS handover settle on an identical frame before anything moves. That includes the
 * native splash's own fade-out, which is real on Android: moving during it leaves a fading copy of
 * the mark behind at the centre (see `NATIVE_SPLASH_FADE_MS`).
 */
const HOLD_MS = NATIVE_SPLASH_FADE_MS + 60;
/** The mark shrinks and glides left into its place in the lockup. */
const MOVE_MS = 560;
/** The wordmark wipes out from behind the mark, starting while the mark is still arriving. */
const WIPE_DELAY_MS = HOLD_MS + 320;
const WIPE_MS = 480;
const INTRO_MS = Math.max(HOLD_MS + MOVE_MS, WIPE_DELAY_MS + WIPE_MS);
/** Lockup lifts and fades while the white ground dissolves onto the first screen. */
const EXIT_MS = 420;
/** A session restore still running this long after the intro gets a spinner under the lockup. */
const SPINNER_AFTER_MS = 900;
/**
 * If the mark never reports that it has been drawn, hide the native splash anyway. A missed
 * `onDisplay` must never leave the app stuck behind the OS splash.
 */
const DISPLAY_TIMEOUT_MS = 800;

/** Final lockup width, and the side margin it keeps on the narrowest phones. */
const LOCKUP_MAX_WIDTH = 300;
const LOCKUP_SIDE_MARGIN = 32;

/**
 * The launch animation, drawn over the whole app on a cold start.
 *
 * 1. **Handover.** Its first frame is the native splash, redrawn exactly: the mark alone, centred,
 *    at `NATIVE_MARK_SIZE` on white. It hides the native splash only once that mark has actually
 *    been drawn, so the switch cannot show.
 * 2. **Intro.** The mark shrinks into its slot in the TejoTime lockup while the wordmark wipes out
 *    from behind it (`INTRO_MS`, under a second).
 * 3. **Exit.** It leaves once the intro has played AND the saved session has been restored. The
 *    lockup lifts and fades, and the white ground dissolves onto whichever screen is now underneath
 *    it (login, or the dashboard's first-load skeletons). If the restore is slow, a spinner appears
 *    in the meantime.
 *
 * Reduce Motion skips the intro. The mark simply fades out when the app is ready.
 *
 * It renders over the navigator rather than in place of it, so the first screen is fully laid out
 * underneath by the time the exit reveals it. The layouts that gate on `authLoading` still draw
 * `TSplashScreen` below it, as a fallback.
 *
 * Geometry comes from `splash-geometry.json`, written by `scripts/make-app-icons.mjs` alongside the
 * two images, so re-cutting the logo cannot leave these numbers stale.
 */
export function TAnimatedSplash() {
  const { authLoading } = useAppState();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();

  const [shown, setShown] = useState(false);
  const [introDone, setIntroDone] = useState(reduceMotion);
  const [slow, setSlow] = useState(false);
  const [done, setDone] = useState(false);
  // `shown` too: with Reduce Motion `introDone` starts true, and the exit must still wait for the
  // handover, or it could play out while the native splash is still covering it.
  const exiting = shown && introDone && !authLoading;

  const intro = useSharedValue(0);
  const wipe = useSharedValue(0);
  const exit = useSharedValue(0);

  /* ---- Lockup geometry, in points relative to the screen centre ---- */
  const { lockup, markArt } = geometry;
  const lockupWidth = Math.min(LOCKUP_MAX_WIDTH, windowWidth - LOCKUP_SIDE_MARGIN * 2);
  const k = lockupWidth / lockup.width;
  const lockupHeight = lockup.height * k;
  const left0 = -lockupWidth / 2;
  const top0 = -lockupHeight / 2;
  // The new artwork is fitted into the box the lockup's own mark occupied.
  const slot = lockup.mark;
  const artWidth = Math.min(slot.width * k, slot.height * k * (markArt.width / markArt.height));
  const markEndScale = artWidth / markArt.width / NATIVE_MARK_SIZE;
  const markEndX = left0 + (slot.x + slot.width / 2) * k;
  const markEndY = top0 + (slot.y + slot.height / 2) * k;
  const wordLeft = left0 + lockup.wordmark.x * k;
  const wordTop = top0 + lockup.wordmark.y * k;
  const wordWidth = lockup.wordmark.width * k;
  const wordHeight = lockup.wordmark.height * k;

  // Hide the native splash the moment our identical first frame is on screen. The timer is the
  // safety net for an image that never reports in.
  useEffect(() => {
    if (shown) {
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    const timer = setTimeout(() => setShown(true), DISPLAY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    if (!shown || reduceMotion) return;
    intro.value = withDelay(HOLD_MS, withTiming(1, { duration: MOVE_MS, easing: Easing.bezier(0.65, 0, 0.35, 1) }));
    wipe.value = withDelay(WIPE_DELAY_MS, withTiming(1, { duration: WIPE_MS, easing: Easing.out(Easing.cubic) }));
    const timer = setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => clearTimeout(timer);
  }, [shown, reduceMotion, intro, wipe]);

  useEffect(() => {
    if (!introDone || !authLoading) return;
    const timer = setTimeout(() => setSlow(true), SPINNER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [introDone, authLoading]);

  useEffect(() => {
    if (!exiting) return;
    exit.value = withTiming(1, { duration: EXIT_MS, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => setDone(true), EXIT_MS);
    return () => clearTimeout(timer);
  }, [exiting, exit]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: markEndX * intro.value },
      { translateY: markEndY * intro.value },
      { scale: 1 + (markEndScale - 1) * intro.value },
    ],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    width: wordWidth * wipe.value,
    opacity: interpolate(wipe.value, [0, 0.35], [0, 1], Extrapolation.CLAMP),
  }));
  const stageStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 0.75], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: 1 + 0.08 * exit.value }],
  }));
  const groundStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));

  if (done) return null;

  return (
    // Swallows touches until the exit starts, so nothing underneath can be tapped blind.
    <View style={StyleSheet.absoluteFill} pointerEvents={exiting ? 'none' : 'auto'}>
      <Animated.View style={[StyleSheet.absoluteFill, splashStyles.ground, groundStyle]} />
      <View style={splashStyles.centre} pointerEvents="none">
        {/* A zero-size stage at the exact screen centre: every piece is placed relative to it,
            and scaling it scales the whole lockup about the centre. */}
        <Animated.View
          style={[splashStyles.stage, stageStyle]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t.common.brand}>
          <Animated.View style={[splashStyles.mark, markStyle]}>
            <Image
              source={splashMark}
              style={splashStyles.fill}
              contentFit="contain"
              onDisplay={() => setShown(true)}
            />
          </Animated.View>
          <Animated.View style={[splashStyles.wordClip, { left: wordLeft, top: wordTop, height: wordHeight }, wordStyle]}>
            <Image source={wordmark} style={{ width: wordWidth, height: wordHeight }} contentFit="contain" />
          </Animated.View>
          {slow && !exiting ? (
            <Animated.View entering={FadeIn.duration(300)} style={[splashStyles.loader, { top: lockupHeight / 2 + 36 }]}>
              <ActivityIndicator size="small" color={palette.brandInk} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const splashStyles = StyleSheet.create({
  ground: { backgroundColor: SPLASH_BACKGROUND },
  centre: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  stage: { width: 0, height: 0 },
  mark: {
    position: 'absolute',
    left: -NATIVE_MARK_SIZE / 2,
    top: -NATIVE_MARK_SIZE / 2,
    width: NATIVE_MARK_SIZE,
    height: NATIVE_MARK_SIZE,
  },
  fill: { width: '100%', height: '100%' },
  // Grows from zero width to reveal the wordmark left to right, out from behind the mark.
  wordClip: { position: 'absolute', overflow: 'hidden' },
  loader: { position: 'absolute', left: -50, width: 100, alignItems: 'center' },
});
