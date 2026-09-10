/**
 * Responsive scaling, adapted from react-native-size-matters.
 *
 * - scale / getWidth — width-based
 * - verticalScale / getHeight — height-based
 * - moderateScale — moderate width-based (default factor 0.5)
 * - moderateVerticalScale — moderate height-based
 *
 * These deliberately **shadow** the `react-native-size-matters` exports of the
 * same names, and every call site in the app imports them from here. Two things
 * the library does not do, and that a tablet build needs:
 *
 * 1. **It never stops growing.** The library's ratio is `window.width / 350`
 *    with no ceiling, so on an iPad (834dp portrait, 1194dp landscape) a
 *    `moderateScale(16)` padding became 35–60dp and a 12dp radius became a
 *    28dp blob. Every spacing token in the app is built from `moderateScale`,
 *    so the whole UI was inflating by 2.4–3.9× on tablets.
 * 2. **It samples the window once, at import time.** That was safe while the
 *    app was portrait-locked. Tablets now rotate and can be resized live (iPad
 *    Split View, Android split-screen), and `StyleSheet.create` runs at module
 *    load — so a sampled window width would be frozen at whatever the app
 *    happened to launch at and then be wrong for the rest of the session.
 *
 * Both are fixed by measuring the **device screen's short side** and clamping
 * it. The short side of the physical screen does not change when you rotate the
 * device or narrow the app's window, so a value computed at module load stays
 * correct — and clamping means a tablet plateaus instead of ballooning. Layout
 * that genuinely must react to the live window size uses `useResponsive`, which
 * is reactive; this module is for the fixed type/spacing ramp only.
 */
import { Dimensions } from 'react-native';

/** Design baseline (react-native-size-matters' guideline size). 1:1 at this size. */
const GUIDELINE_BASE_WIDTH = 350;
const GUIDELINE_BASE_HEIGHT = 680;

/**
 * Clamp range for the width basis. The floor keeps a small phone (320dp) from
 * shrinking controls below the 44dp touch-target minimum; the ceiling is where
 * growth stops, so a 600dp tablet and a 1366dp one get the same comfortable
 * sizing rather than a scaled-up phone UI. Tablets gain their extra room
 * through *layout* — wider columns and grids, see `@/lib/responsive` — not
 * through bigger text.
 */
const MIN_SCALE_WIDTH = 320;
const MAX_SCALE_WIDTH = 480;
const MIN_SCALE_HEIGHT = 568;
const MAX_SCALE_HEIGHT = 900;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Orientation-invariant device dimensions.
 *
 * `screen` (not `window`) is the physical display, so it is unaffected by iPad
 * Split View; `min`/`max` make it unaffected by rotation. Read once — by
 * construction there is nothing left for it to react to.
 */
const screen = Dimensions.get('screen');
const shortSide = Math.min(screen.width, screen.height);
const longSide = Math.max(screen.width, screen.height);

const widthRatio = clamp(shortSide, MIN_SCALE_WIDTH, MAX_SCALE_WIDTH) / GUIDELINE_BASE_WIDTH;
const heightRatio = clamp(longSide, MIN_SCALE_HEIGHT, MAX_SCALE_HEIGHT) / GUIDELINE_BASE_HEIGHT;

const round = (n: number) => Math.round(n * 100) / 100;

/** Linear width-based scale. */
export const scale = (size: number): number => round(size * widthRatio);

/** Linear height-based scale. */
export const verticalScale = (size: number): number => round(size * heightRatio);

/**
 * Width-based scale with a damping factor — the workhorse for padding, radii,
 * gaps and control sizes.
 *
 * @param size   design value at the 350dp baseline
 * @param factor 0 = fixed, 1 = linear. Default 0.5.
 */
export const moderateScale = (size: number, factor = 0.5): number =>
  round(size + (size * widthRatio - size) * factor);

/** Height-based counterpart to {@link moderateScale}. */
export const moderateVerticalScale = (size: number, factor = 0.5): number =>
  round(size + (size * heightRatio - size) * factor);

/** @deprecated Prefer `scale`. */
export const getWidth = scale;

/** @deprecated Prefer `verticalScale`. */
export const getHeight = verticalScale;

/**
 * Width-aware "responsive size". Identical to {@link moderateScale}; kept as a
 * separate name because it reads better at the call sites that use it for font
 * sizes and icon sizes.
 *
 * @param size   design value at the 350dp baseline
 * @param factor how strongly to scale (0 = fixed, 1 = linear). Default 0.5.
 */
export function rSize(size: number, factor = 0.5): number {
  return moderateScale(size, factor);
}

/** Responsive font size — `rSize` tuned for typography. */
export const scaleFont = (size: number): number => rSize(size, 0.5);
