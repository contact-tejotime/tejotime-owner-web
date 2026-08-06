/**
 * Brand ramp generation.
 *
 * A store owner picks ONE hex. Everything a UI needs — the hover state, the pressed state,
 * the 5%-tint chip background, the border, the dark-mode variant — has to come out of it and
 * still look like a designed scale rather than an opacity slider.
 *
 * Method: ANCHOR the seed at step 600, then walk a perceptual lightness curve outward from it,
 * scaling a fixed chroma curve by the seed's own chroma (gamut-mapped per step).
 *
 * WHY anchored rather than a fixed lightness curve: step 600 is `--brand`/`--primary`, i.e. the
 * colour the owner actually picked in the Appearance panel. Dropping the seed onto a fixed curve
 * makes the picker lie — #FF5A5F came back as #d22c3b and #B08D57 as #9c6b00, and the previous
 * `theme_color` behaviour used the hex verbatim. So 600 IS the seed, byte for byte, and the other
 * nine stops are derived around it. Readability is not sacrificed for this: resolve.ts picks the
 * ink (`--on-brand`) by real contrast ratio and repairs the hover/pressed steps, so a pastel brand
 * gets dark ink rather than a darkened brand.
 *
 * The cost is that L is no longer identical across brands — a light brand yields a light button.
 * That is the correct trade for a white-label product. Only genuinely unusable seeds are clamped
 * (see ANCHOR_MIN/ANCHOR_MAX): pure black and pure white cannot carry a ten-stop scale.
 *
 * Curated ramps win over generated ones (`BUILTIN_RAMPS`), because for the colours we actually
 * ship — the current TejoTime blue above all — a hand-tuned Tailwind scale beats anything an
 * algorithm produces, and #2563EB has to reproduce globals.css byte for byte.
 */

import type { ColorRamp, RampStop } from '../types';
import { RAMP_STOPS } from '../types';
import { clampChromaToGamut, deltaEOk, hexToOklch, oklchToHex } from './oklch';

/**
 * Reference OKLab lightness per stop — the SHAPE of the curve, not absolute targets.
 *
 * Calibrated against the six Tailwind ramps this codebase already uses (blue, teal, emerald,
 * rose, violet, amber). `generateRamp` re-anchors this shape so that step 600 lands on the
 * seed's own lightness; these numbers then only decide how the remaining stops are spaced
 * either side of it.
 */
const L_CURVE: Record<RampStop, number> = {
  50: 0.972,
  100: 0.94,
  200: 0.892,
  300: 0.824,
  400: 0.742,
  500: 0.655,
  600: 0.566,
  700: 0.5,
  800: 0.436,
  900: 0.384,
};

/**
 * Chroma multiplier per stop, relative to the seed's chroma at 600.
 * Damped hard at 50/100 (a tint that keeps full chroma reads as a stain, not a surface) and
 * eased off past 700 (deep colours lose chroma headroom in sRGB anyway).
 */
const C_CURVE: Record<RampStop, number> = {
  50: 0.08,
  100: 0.19,
  200: 0.35,
  300: 0.55,
  400: 0.78,
  500: 0.93,
  600: 1,
  700: 0.97,
  800: 0.83,
  900: 0.68,
};

/**
 * Curated scales, keyed by UPPERCASE hex.
 *
 * `#2563EB` is load-bearing: it is the current `--blue-*` scale from globals.css verbatim, so
 * an untouched store resolves to exactly today's pixels. The rest are the colours the presets
 * ship as accents — using their real designed scales keeps `--secondary`/`--secondary-hover`
 * at teal-500/teal-600 instead of near-misses.
 */
export const BUILTIN_RAMPS: Record<string, ColorRamp> = {
  /* Tailwind blue — the TejoTime primary. MUST match globals.css `--blue-*`. */
  '#2563EB': {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  /* Tailwind teal — `minimal`'s accent; preserves today's `--secondary` (teal-500). */
  '#14B8A6': {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#134e4a',
  },
  /* Tailwind emerald — `medical`'s calm green. */
  '#10B981': {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  /* Soft gold — `luxury`. Hand-tuned around the seed at step 600. */
  '#C9A227': {
    50: '#fdf9ec',
    100: '#f9f0cd',
    200: '#f1de99',
    300: '#e5c862',
    400: '#d9b342',
    500: '#c9a227',
    600: '#a8851d',
    700: '#856819',
    800: '#5f4a14',
    900: '#463710',
  },
  /* Warm orange — `warm`. Hand-tuned around the seed at step 600. */
  '#E07A3F': {
    50: '#fdf5ef',
    100: '#fae7d6',
    200: '#f4cba8',
    300: '#eaab77',
    400: '#e59058',
    500: '#e07a3f',
    600: '#c15f28',
    700: '#994a1f',
    800: '#6d3517',
    900: '#502712',
  },
};

/**
 * Lightness band the anchor is allowed to occupy.
 *
 * Outside it a ten-stop scale cannot exist: #FFFFFF has no room for 50–500 above it and
 * #000000 none for 700–900 below. Those two seeds are clamped inward (and only those two in
 * practice — #FFEB3B sits at L 0.93 and #1A1A1A at 0.20, both well inside).
 */
const ANCHOR_MIN = 0.16;
const ANCHOR_MAX = 0.94;

/** Lightness the 50 and 900 ends reach for, unless the anchor crowds them. */
const L_TOP = L_CURVE[50];
const L_BOTTOM = L_CURVE[900];

/**
 * Build a 10-stop scale from one seed hex, with the seed AT step 600.
 *
 * `generateRamp(x)[600] === x` for every seed inside the anchor band — that identity is what
 * makes the brand picker honest, and __tests__/run.ts asserts it across the full hue circle.
 *
 * Calibration note: `generateRamp('#2563EB')` vs the curated Tailwind blue above stays within
 * ~0.05 OKLab ΔE per step. The curated ramp is still what that seed returns; the figure is
 * printed by the test so the curve can be re-checked whenever L_CURVE/C_CURVE are touched.
 */
export function generateRamp(seedHex: string): ColorRamp {
  const curated = BUILTIN_RAMPS[seedHex.toUpperCase()];
  if (curated) return { ...curated };

  const seed = hexToOklch(seedHex);
  const anchor = Math.min(ANCHOR_MAX, Math.max(ANCHOR_MIN, seed.l));

  // Head-room either side of the anchor. Guaranteed non-zero by the clamp above, so the
  // interpolations below are strictly monotonic and no two stops can collide.
  const up = Math.max(L_TOP, anchor + 0.04) - anchor;
  const down = anchor - Math.min(L_BOTTOM, anchor - 0.04);

  const out = {} as ColorRamp;
  for (const stop of RAMP_STOPS) {
    // Re-map the reference curve's position relative to 600 onto the available head-room.
    let l: number;
    if (stop === 600) {
      l = anchor;
    } else if (stop < 600) {
      const t = (L_CURVE[stop] - L_CURVE[600]) / (L_CURVE[50] - L_CURVE[600]);
      l = anchor + t * up;
    } else {
      const t = (L_CURVE[600] - L_CURVE[stop]) / (L_CURVE[600] - L_CURVE[900]);
      l = anchor - t * down;
    }

    const fitted = clampChromaToGamut({ l, c: seed.c * C_CURVE[stop], h: seed.h });
    out[stop] = oklchToHex(fitted.l, fitted.c, fitted.h);
  }

  // Step 600 is the owner's colour, verbatim — never an oklch round-trip of it, which can
  // drift a unit per channel and would make the picker show a different hex than it stored.
  if (seed.l >= ANCHOR_MIN && seed.l <= ANCHOR_MAX) out[600] = seedHex.toLowerCase();
  return out;
}

/** Ramp as a light→dark array — the shape `ensureContrast()` walks. */
export function rampToArray(ramp: ColorRamp): string[] {
  return RAMP_STOPS.map((s) => ramp[s]);
}

/**
 * Rotate a seed's hue (and optionally push chroma) before ramping.
 * `bold` uses this for its complementary accent; the +180° result is contrast-checked by
 * resolve.ts like any other colour, so a low-chroma brand cannot produce a mud accent.
 */
export function rotatedRamp(seedHex: string, hueShift: number, chromaBoost = 1): ColorRamp {
  const seed = hexToOklch(seedHex);
  const h = ((seed.h + hueShift) % 360 + 360) % 360;
  const rotated = oklchToHex(seed.l, seed.c * chromaBoost, h);
  return generateRamp(rotated);
}

/** Max/mean OKLab ΔE between two ramps — used by the calibration assertion in __tests__. */
export function rampDelta(a: ColorRamp, b: ColorRamp): { max: number; mean: number } {
  const deltas = RAMP_STOPS.map((s) => deltaEOk(a[s], b[s]));
  return {
    max: Math.max(...deltas),
    mean: deltas.reduce((x, y) => x + y, 0) / deltas.length,
  };
}
