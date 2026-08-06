/**
 * WCAG 2.x contrast maths + the "pick / repair a foreground" helpers.
 *
 * WHY this file exists: `frontend/src/lib/theme-color.ts` decides white-on-brand readability
 * with `luminance > 0.55`, which is roughly a 1.75:1 ratio — it lets through pairings that
 * fail AA by a mile. Every foreground in this engine is instead chosen by real ratio and, if
 * it does not clear its threshold, walked toward the passing end until it does.
 *
 * Useful fact that makes the walk always terminate successfully: for any background the
 * better of pure white / pure black scores at least 4.58:1 (worst case is a background with
 * relative luminance 0.179). So a 4.5 gate is always reachable.
 */

import {
  hexToOklch,
  hexToRgb,
  oklchToHex,
  srgbToLinear,
} from './oklch';

/** WCAG relative luminance, 0–1. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_BODY = 4.5;
export const AA_LARGE = 3;

export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= AA_BODY;
}

export function meetsAALarge(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= AA_LARGE;
}

/**
 * Pick whichever candidate reads better on `bg`.
 * Defaults are white and the slate-900 ink the design system already uses as `--text-strong`,
 * so on a light surface this returns the familiar #0f172a rather than pure black.
 */
export function onColor(bg: string, light = '#ffffff', dark = '#0f172a'): string {
  return contrastRatio(light, bg) >= contrastRatio(dark, bg) ? light : dark;
}

/**
 * Same choice, but the foreground has to survive against SEVERAL backgrounds — a gradient
 * hero, where one label sits over three different stops. Returns the candidate with the best
 * worst-case ratio.
 */
export function onColorMulti(bgs: readonly string[], light = '#ffffff', dark = '#0f172a'): string {
  const worst = (fg: string) => bgs.reduce((m, bg) => Math.min(m, contrastRatio(fg, bg)), Infinity);
  return worst(light) >= worst(dark) ? light : dark;
}

/** Of a set of backgrounds, the one this foreground reads worst against. */
export function worstBackground(fg: string, bgs: readonly string[]): string {
  let worst = bgs[0];
  let worstRatio = Infinity;
  for (const bg of bgs) {
    const r = contrastRatio(fg, bg);
    if (r < worstRatio) {
      worstRatio = r;
      worst = bg;
    }
  }
  return worst;
}

/**
 * Walk `fg` toward the end that improves contrast with `bg` until the ratio clears `min`.
 *
 * - With a `ramp` (an ordered light→dark scale) the walk steps through real designed colours,
 *   so `--secondary-soft-fg` lands on teal-700 rather than an invented off-ramp teal.
 * - Without one, lightness is nudged in OKLCH (hue kept, chroma damped as it approaches the
 *   extremes so a "lighter red" does not become a neon pink) and finishes at pure white/black.
 *
 * If nothing clears `min`, the better of white/black is returned — never a failing colour.
 * Returns `fg` untouched when it already passes, which is what keeps parity intact: every
 * legacy pairing in globals.css already clears its tier.
 */
export function ensureContrast(
  fg: string,
  bg: string,
  min = AA_BODY,
  ramp?: readonly string[],
): string {
  if (contrastRatio(fg, bg) >= min) return fg;

  const bgIsDark = relativeLuminance(bg) < 0.5;

  if (ramp && ramp.length > 0) {
    const fixed = walkRamp(fg, bg, min, ramp, bgIsDark);
    if (fixed) return fixed;
  }

  const start = hexToOklch(fg);
  // 0 → 1 in 0.02 steps covers the full range; 60 iterations is plenty and bounded.
  for (let i = 1; i <= 60; i += 1) {
    const delta = 0.02 * i;
    const l = bgIsDark ? Math.min(1, start.l + delta) : Math.max(0, start.l - delta);
    // Chroma cannot survive at the extremes; taper it or the walk stalls on an out-of-gamut hue.
    const taper = 1 - Math.abs(l - 0.5) * 1.6;
    const c = Math.max(0, start.c * Math.max(0, taper));
    const candidate = oklchToHex(l, c, start.h);
    if (contrastRatio(candidate, bg) >= min) return candidate;
    if (l <= 0 || l >= 1) break;
  }

  return onColor(bg, '#ffffff', '#000000');
}

/**
 * Step through `ramp` from the entry closest to `fg` toward the passing end.
 * Returns undefined when the ramp cannot get there (caller falls back to the OKLCH walk).
 */
function walkRamp(
  fg: string,
  bg: string,
  min: number,
  ramp: readonly string[],
  bgIsDark: boolean,
): string | undefined {
  // Ramps are authored light→dark. On a dark background we need lighter, so walk backwards.
  const dir = bgIsDark ? -1 : 1;
  let start = ramp.indexOf(fg);
  if (start < 0) start = nearestIndex(fg, ramp);
  for (let i = start; i >= 0 && i < ramp.length; i += dir) {
    if (contrastRatio(ramp[i], bg) >= min) return ramp[i];
  }
  return undefined;
}

function nearestIndex(hex: string, ramp: readonly string[]): number {
  const target = relativeLuminance(hex);
  let best = 0;
  let bestDelta = Infinity;
  ramp.forEach((c, i) => {
    const d = Math.abs(relativeLuminance(c) - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return best;
}
