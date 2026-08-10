/**
 * sRGB ⇄ OKLab/OKLCH conversion (Björn Ottosson's matrices).
 *
 * WHY OKLCH and not HSL: the old `theme-color.ts` builds tints by mixing toward black/white
 * in sRGB, which drifts hue badly on saturated blues and turns yellows muddy. OKLab is
 * perceptually uniform, so "same hue, lighter" is an honest L change and a generated ramp
 * looks like a hand-picked one.
 *
 * Everything here is pure arithmetic on plain numbers/strings. No dependencies.
 */

export interface RGB {
  /** 0–255. */
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, 0–~0.4 in sRGB. */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Same guard as `frontend/src/lib/theme-color.ts` — kept local so this folder imports nothing. */
export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/* ============================================================
   hex ⇄ rgb
   ============================================================ */

/** Throws on malformed input — callers validate with `isHex()` first. */
export function hexToRgb(hex: string): RGB {
  if (!isHex(hex)) throw new Error(`hexToRgb: not a #rrggbb hex: ${String(hex)}`);
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Lowercase `#rrggbb` — globals.css is lowercase, and parity is compared as exact strings. */
export function rgbToHex(rgb: RGB): string {
  const part = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/* ============================================================
   sRGB transfer function
   ============================================================ */

/** sRGB 0–1 → linear-light 0–1. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light 0–1 → sRGB 0–1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/* ============================================================
   OKLab
   ============================================================ */

/** 0–255 sRGB → OKLab. */
export function rgbToOklab(rgb: RGB): Oklab {
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/**
 * OKLab → 0–255 sRGB. Components are NOT clamped: `isInGamut()` needs to see the overshoot
 * to decide whether chroma must come down.
 */
export function oklabToRgb(lab: Oklab): RGB {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 255 * linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: 255 * linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: 255 * linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/* ============================================================
   OKLCH (polar OKLab)
   ============================================================ */

export function oklabToOklch(lab: Oklab): Oklch {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  // Below this chroma the hue angle is pure quantisation noise; pin it to 0 so grays are stable.
  return { l: lab.L, c, h: c < 1e-6 ? 0 : h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const rad = (lch.h * Math.PI) / 180;
  return { L: lch.l, a: Math.cos(rad) * lch.c, b: Math.sin(rad) * lch.c };
}

export function hexToOklch(hex: string): Oklch {
  return oklabToOklch(rgbToOklab(hexToRgb(hex)));
}

/* ============================================================
   Gamut mapping
   ============================================================ */

/** A hair of slack so values that land on 255.0000001 are not treated as out of gamut. */
const GAMUT_EPS = 0.5 / 255;

function isInGamut(rgb: RGB): boolean {
  const lo = -GAMUT_EPS * 255;
  const hi = 255 + GAMUT_EPS * 255;
  return rgb.r >= lo && rgb.r <= hi && rgb.g >= lo && rgb.g <= hi && rgb.b >= lo && rgb.b <= hi;
}

/**
 * Reduce chroma (never lightness, never hue) until the colour fits sRGB.
 *
 * WHY not just clip the channels: clipping a too-saturated blue clamps b to 255 and leaves
 * r/g untouched, which shifts hue and flattens lightness — the classic "neon smear". Walking
 * chroma down keeps the hue exact and only gives up saturation, which is what a designer
 * would do by hand. 24 bisection steps resolve chroma to <1e-7, far below 8-bit output.
 */
export function clampChromaToGamut(lch: Oklch): Oklch {
  const l = clamp(lch.l, 0, 1);
  if (lch.c <= 0) return { l, c: 0, h: lch.h };
  if (isInGamut(oklabToRgb(oklchToOklab({ l, c: lch.c, h: lch.h })))) {
    return { l, c: lch.c, h: lch.h };
  }
  let lo = 0;
  let hi = lch.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (isInGamut(oklabToRgb(oklchToOklab({ l, c: mid, h: lch.h })))) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h: lch.h };
}

/** OKLCH → in-gamut lowercase `#rrggbb`. The one function ramp/mix code should call. */
export function oklchToHex(l: number, c: number, h: number): string {
  const fitted = clampChromaToGamut({ l, c, h });
  const rgb = oklabToRgb(oklchToOklab(fitted));
  return rgbToHex({
    r: clamp(rgb.r, 0, 255),
    g: clamp(rgb.g, 0, 255),
    b: clamp(rgb.b, 0, 255),
  });
}

/* ============================================================
   Mixing helpers
   ============================================================ */

/**
 * Mix in sRGB. Use this (not OKLab) when emulating what CSS alpha compositing would have
 * produced — e.g. flattening `rgba(brand, 0.16)` over a dark surface into an opaque token,
 * so contrast maths stays exact instead of guessing at what is behind the panel.
 */
export function mixSrgb(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return rgbToHex({
    r: x.r + (y.r - x.r) * k,
    g: x.g + (y.g - x.g) * k,
    b: x.b + (y.b - x.b) * k,
  });
}

/** Perceptual mix — for blending design colours (hero stops, tints) without hue drift. */
export function mixOklab(a: string, b: string, t: number): string {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  const k = clamp(t, 0, 1);
  const lch = oklabToOklch({
    L: x.L + (y.L - x.L) * k,
    a: x.a + (y.a - x.a) * k,
    b: x.b + (y.b - x.b) * k,
  });
  return oklchToHex(lch.l, lch.c, lch.h);
}

/** Perceptual distance in OKLab. ~0.02 is a just-noticeable difference. */
export function deltaEOk(a: string, b: string): number {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** `rgba(r, g, b, a)` with globals.css's exact spacing — scrims, shadows and glass need it. */
export function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(alpha)})`;
}

/** `0.06` not `0.060000000000000005`; `0` not `0.0`. */
export function formatAlpha(alpha: number): string {
  const a = clamp(alpha, 0, 1);
  return String(Math.round(a * 1000) / 1000);
}
