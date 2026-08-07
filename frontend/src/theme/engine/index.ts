/**
 * TejoTime theme engine — public surface.
 *
 * Import from `@/theme/engine` (or a relative path from a non-Next consumer); never reach
 * into the sub-modules directly, so the internals stay free to move.
 *
 * The engine is pure TypeScript with no imports outside this folder: safe in a React Server
 * Component, in a client component, and in a plain `tsx` script.
 *
 * Typical use in the microsite:
 *   const theme = resolveTheme({ ...normalizeThemeConfig(site.theme), brand: site.themeColor });
 *   <style dangerouslySetInnerHTML={{ __html: themeToCss(theme, '#tt-site') }} />
 *   <div id="tt-site" {...themeAttributes(theme)}>…</div>
 */

/* ---- Types & contract ---- */
export type {
  AccentStrategy,
  AnimationId,
  AnimationScale,
  BrandInkId,
  ColorRamp,
  ContrastCheck,
  ContrastReport,
  ContrastTier,
  DensityId,
  DensityScale,
  EffectiveThemeConfig,
  HeroGradientRecipe,
  HeroStop,
  HeroStopSource,
  HeroVariantId,
  HeroVariantMeta,
  LegacyTokenName,
  ModeId,
  NeutralRamp,
  NeutralStop,
  NewTokenName,
  PresetDefinition,
  PresetId,
  RadiusId,
  RadiusScale,
  RampStop,
  ResolvedTheme,
  ShadowId,
  ShadowLayer,
  ShadowScale,
  ThemeConfig,
  TokenMap,
  TypeSet,
  TypeSetId,
} from './types';

export {
  ANIMATION_IDS,
  BRAND_INK_IDS,
  DENSITY_IDS,
  EXTRA_TOKEN_NAMES,
  HERO_VARIANT_IDS,
  LEGACY_TOKEN_NAMES,
  MODE_IDS,
  NEUTRAL_STOPS,
  NEW_TOKEN_NAMES,
  PRESET_IDS,
  RADIUS_IDS,
  RAMP_STOPS,
  SHADOW_IDS,
  TYPE_SET_IDS,
} from './types';

/* ---- Colour utilities ---- */
export {
  clampChromaToGamut,
  deltaEOk,
  formatAlpha,
  hexToOklch,
  hexToRgb,
  isHex,
  linearToSrgb,
  mixOklab,
  mixSrgb,
  oklabToOklch,
  oklabToRgb,
  oklchToHex,
  oklchToOklab,
  rgbaString,
  rgbToHex,
  rgbToOklab,
  srgbToLinear,
} from './color/oklch';
export type { Oklab, Oklch, RGB } from './color/oklch';

export {
  AA_BODY,
  AA_LARGE,
  contrastRatio,
  ensureContrast,
  meetsAA,
  meetsAALarge,
  onColor,
  onColorMulti,
  relativeLuminance,
  worstBackground,
} from './color/contrast';

export { BUILTIN_RAMPS, generateRamp, rampDelta, rampToArray, rotatedRamp } from './color/ramp';

/* ---- Presets & scales ---- */
export { getPreset, PRESET_LIST, PRESETS } from './presets';
export { ANIMATION_SCALES, DENSITY_SCALES, RADIUS_SCALES, SHADOW_SCALES } from './modifiers';
export { TYPE_SETS } from './typography';
export { defaultHeroVariantFor, HERO_VARIANT_LIST, HERO_VARIANTS } from './hero';

/* ---- Config ---- */
export {
  CATEGORY_PRESETS,
  DEFAULT_THEME_CONFIG,
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  presetForCategory,
} from './defaults';

/* ---- Resolve & emit ---- */
export { resolveTheme, tokensForMode } from './resolve';
export { cssVarsObject, themeAttributes, themeToCss } from './css';
