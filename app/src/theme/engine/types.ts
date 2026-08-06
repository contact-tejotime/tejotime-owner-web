/**
 * Theme engine — shared types + the frozen token contract.
 *
 * WHY this file exists: the engine, the admin preview, the microsite renderer and the
 * backend validator all have to agree on exactly one vocabulary. Everything downstream
 * imports its ids and token names from here so a rename is a compile error, not a
 * silently-broken store page.
 *
 * The id unions are derived from `as const` arrays because `normalizeThemeConfig()` needs
 * the same lists at runtime to repair untrusted jsonb coming out of Postgres.
 *
 * This module (and every module under theme/engine/) is pure TypeScript: no React, no DOM,
 * no node APIs, no imports outside this folder. It is safe in an RSC, a client component
 * and a plain `tsx` script.
 */

/* ============================================================
   Axis ids
   ============================================================ */

export const PRESET_IDS = ['minimal', 'luxury', 'modern', 'bold', 'medical', 'warm'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const MODE_IDS = ['light', 'dark', 'auto'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const RADIUS_IDS = ['sharp', 'medium', 'rounded'] as const;
export type RadiusId = (typeof RADIUS_IDS)[number];

export const SHADOW_IDS = ['none', 'soft', 'premium'] as const;
export type ShadowId = (typeof SHADOW_IDS)[number];

export const DENSITY_IDS = ['comfortable', 'compact'] as const;
export type DensityId = (typeof DENSITY_IDS)[number];

export const ANIMATION_IDS = ['subtle', 'normal', 'rich'] as const;
export type AnimationId = (typeof ANIMATION_IDS)[number];

export const HERO_VARIANT_IDS = [
  'split-classic',
  'editorial',
  'split-modern',
  'full-bleed',
  'trust',
  'cozy',
] as const;
export type HeroVariantId = (typeof HERO_VARIANT_IDS)[number];

export const TYPE_SET_IDS = [
  'geometric',
  'serif-display',
  'grotesk',
  'condensed-heavy',
  'clinical',
  'friendly',
] as const;
export type TypeSetId = (typeof TYPE_SET_IDS)[number];

/* ============================================================
   Colour ramps
   ============================================================ */

export const RAMP_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type RampStop = (typeof RAMP_STOPS)[number];

/** A 10-stop brand/accent scale, 50 = lightest … 900 = darkest. */
export type ColorRamp = Record<RampStop, string>;

export const NEUTRAL_STOPS = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type NeutralStop = (typeof NEUTRAL_STOPS)[number];

/**
 * An 11-stop neutral scale. Orientation is ALWAYS 0 = lightest … 900 = darkest, for the
 * light ramp *and* the dark ramp — a preset's dark ramp is a different scale (tuned so its
 * dark end carries the page/card/border steps), not an inversion of the light one.
 */
export type NeutralRamp = Record<NeutralStop, string>;

/** Flat `--token` → value bag. Keys always include the leading `--`. */
export type TokenMap = Record<string, string>;

/* ============================================================
   Preset definition
   ============================================================ */

/** How a preset derives its accent (the "second" colour) from the store brand. */
export type AccentStrategy =
  /** A colour the preset owns outright (teal, gold, emerald, orange). */
  | { kind: 'fixed'; hex: string; step: RampStop }
  /** Re-use the brand ramp at a lighter step — a tint of the store's own colour. */
  | { kind: 'brand-step'; step: RampStop }
  /** Rotate the brand hue (usually +180°) and re-generate — deliberate visual tension. */
  | { kind: 'complementary'; hueShift: number; chromaBoost: number; step: RampStop };

export type HeroStopSource = 'brand' | 'accent' | 'neutral' | 'literal';

/** One stop of the hero gradient recipe. Resolved against the theme's ramps at build time. */
export interface HeroStop {
  from: HeroStopSource;
  /** Ramp step, for `brand` | `accent` | `neutral`. */
  step?: number;
  /** Literal `#rrggbb`, for `literal`. */
  hex?: string;
  /** Optional 0..1 OKLab mix toward the mode's page background — softens a stop. */
  towardBg?: number;
}

export interface HeroGradientRecipe {
  /** CSS gradient angle, e.g. `125deg`. Consumed by whoever renders the hero. */
  angle: string;
  light: [HeroStop, HeroStop, HeroStop];
  dark: [HeroStop, HeroStop, HeroStop];
}

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  neutralsLight: NeutralRamp;
  neutralsDark: NeutralRamp;
  accent: AccentStrategy;
  /** Applied when the admin has not explicitly pinned that axis. */
  defaults: {
    radius: RadiusId;
    shadow: ShadowId;
    density: DensityId;
    animation: AnimationId;
  };
  typeSet: TypeSetId;
  heroVariant: HeroVariantId;
  hero: HeroGradientRecipe;
  /** Emitted as `--border-w`; `bold` is the only preset that wants 2px. */
  borderWidth: string;
}

/* ============================================================
   Typography
   ============================================================ */

export interface TypeSet {
  id: TypeSetId;
  /** CSS font stack for headings. Must only name fonts the app already loads or system faces. */
  display: string;
  /** CSS font stack for body copy. */
  body: string;
  weightDisplay: string;
  weightBody: string;
  weightLabel: string;
  trackingDisplay: string;
  trackingBody: string;
  trackingLabel: string;
  /** `none` | `uppercase` — drives micro-labels ("BOOK NOW", eyebrows). */
  labelTransform: string;
}

/* ============================================================
   Modifier scales
   ============================================================ */

export interface RadiusScale {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
  /**
   * Multiplier emitted as `--radius-scale`, relative to `medium` (== 1).
   *
   * A bridge for code that still hardcodes corner radii in px — the microsite's inline styles
   * carry 31 of them, at nine distinct values that do not map cleanly onto six named steps.
   * `calc(12px * var(--radius-scale))` keeps today's pixel exactly at `medium` while still
   * responding to the control. New components should use the named steps instead.
   */
  scale: number;
}

/** One `box-shadow` layer. `x`/`y`/`blur`/`spread` are px; `alpha` is 0..1. */
export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  alpha: number;
}

export interface ShadowScale {
  xs: ShadowLayer[];
  sm: ShadowLayer[];
  md: ShadowLayer[];
  lg: ShadowLayer[];
  xl: ShadowLayer[];
  /** Focus ring — always emitted, even for `shadow: 'none'`; a11y is not a style choice. */
  ring: ShadowLayer[];
}

export interface DensityScale {
  controlH: { sm: number; md: number; lg: number };
  /** `--space-1` … `--space-8`, in px, index 0 == space-1. */
  space: readonly [number, number, number, number, number, number, number, number];
  sectionY: string;
  cardPad: number;
  gapTight: number;
  gap: number;
  gapLoose: number;
  /**
   * Multiplier emitted as `--density-scale`, relative to `comfortable` (== 1). Same bridging
   * role as `RadiusScale.scale`, for the section paddings the microsite still inlines as
   * `clamp()` expressions: `calc(clamp(40px,7vw,64px) * var(--density-scale))`.
   */
  scale: number;
}

export interface AnimationScale {
  durFast: string;
  durNormal: string;
  durSlow: string;
  easeStandard: string;
  easeEmphasis: string;
  liftY: string;
  scaleHover: string;
}

/* ============================================================
   Hero variant metadata
   ============================================================ */

export interface HeroVariantMeta {
  id: HeroVariantId;
  label: string;
  description: string;
  /** The preset that ships this variant as its default. */
  preset: PresetId;
}

/* ============================================================
   Config + resolved output
   ============================================================ */

/**
 * What a store stores (the `business.theme` jsonb).
 *
 * `preset` / `mode` / `brand` are always concrete — nothing else can supply them. The four
 * modifier axes are optional: absent means "whatever this preset ships with", which is how
 * picking `bold` gets you sharp corners and compact spacing without touching four more
 * controls. Present means the admin overrode it, and the override survives a preset change.
 */
export interface ThemeConfig {
  preset: PresetId;
  mode: ModeId;
  /** `#rrggbb`. The store's brand colour; seeds the brand ramp. */
  brand: string;
  /** Absent → `PresetDefinition.defaults.radius`. */
  radius?: RadiusId;
  /** Absent → `PresetDefinition.defaults.shadow`. */
  shadow?: ShadowId;
  /** Absent → `PresetDefinition.defaults.density`. */
  density?: DensityId;
  /** Absent → `PresetDefinition.defaults.animation`. */
  animation?: AnimationId;
  /** Absent → `PresetDefinition.heroVariant`. */
  heroVariant?: HeroVariantId;
  /** Optional `#rrggbb` override of the preset's accent strategy. */
  accent?: string;
}

/**
 * The config `resolveTheme()` actually used: every axis filled in, preset defaults applied.
 * Read this (not the raw input) when the admin UI needs to show effective values.
 */
export interface EffectiveThemeConfig extends ThemeConfig {
  radius: RadiusId;
  shadow: ShadowId;
  density: DensityId;
  animation: AnimationId;
  heroVariant: HeroVariantId;
}

/**
 * Contrast tiers.
 * - `body`   — text a customer reads. WCAG AA, 4.5:1.
 * - `large`  — headings ≥ 24px / ≥ 19px bold. AA large, 3:1.
 * - `ui`     — icons, indicators, focus rings. WCAG 1.4.11 non-text, 3:1.
 * - `decorative` — reported for transparency but never gated. Gating these would silently
 *   change values the live site already ships (e.g. `--text-subtle` #94a3b8 on #f8fafc is
 *   2.48:1, `--secondary` #14b8a6 on #ffffff is 2.49:1) and break pixel parity.
 */
export type ContrastTier = 'body' | 'large' | 'ui' | 'decorative';

export interface ContrastCheck {
  /** Stable id, e.g. `light/text-body-on-bg`. Safe to use as a React key. */
  id: string;
  label: string;
  tier: ContrastTier;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

export interface ContrastReport {
  light: ContrastCheck[];
  dark: ContrastCheck[];
  /** True when every gated (non-decorative) check passes. Drives the admin AA badge. */
  pass: boolean;
  failures: ContrastCheck[];
}

export interface ResolvedTheme {
  /** Fully normalised config actually used — never the raw input. */
  config: EffectiveThemeConfig;
  preset: PresetDefinition;
  heroVariant: HeroVariantId;
  brandRamp: ColorRamp;
  accentRamp: ColorRamp;
  light: TokenMap;
  dark: TokenMap;
  contrast: ContrastReport;
}

/* ============================================================
   The token contract
   ------------------------------------------------------------
   Two frozen lists. LEGACY names already exist in
   frontend/src/app/globals.css and MUST keep resolving to
   today's values for LEGACY_THEME_CONFIG. NEW names are purely
   additive. `themeToCss()` emits every name in both lists, in
   all three blocks.
   ============================================================ */

export const LEGACY_TOKEN_NAMES = [
  '--primary',
  '--primary-hover',
  '--primary-active',
  '--primary-soft',
  '--primary-soft-fg',
  '--secondary',
  '--secondary-hover',
  '--secondary-soft',
  '--secondary-soft-fg',
  '--surface-page',
  '--surface-card',
  '--surface-sunken',
  '--surface-hover',
  '--surface-inverse',
  '--text-strong',
  '--text-body',
  '--text-muted',
  '--text-subtle',
  '--text-on-brand',
  '--text-link',
  '--border-subtle',
  '--border-default',
  '--border-strong',
  '--border-focus',
  '--success',
  '--success-soft',
  '--success-soft-fg',
  '--warning',
  '--warning-soft',
  '--warning-soft-fg',
  '--error',
  '--error-soft',
  '--error-soft-fg',
  '--info',
  '--info-soft',
  '--info-soft-fg',
  '--brand-ink',
  '--brand-accent',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-pill',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--ring',
  '--control-h-sm',
  '--control-h-md',
  '--control-h-lg',
] as const;

export const NEW_TOKEN_NAMES = [
  '--brand-50',
  '--brand-100',
  '--brand-200',
  '--brand-300',
  '--brand-400',
  '--brand-500',
  '--brand-600',
  '--brand-700',
  '--brand-800',
  '--brand-900',
  '--brand',
  '--brand-hover',
  '--brand-pressed',
  '--brand-subtle',
  '--brand-subtle-fg',
  '--brand-border',
  '--brand-outline',
  '--on-brand',
  '--accent',
  '--accent-hover',
  '--accent-subtle',
  '--accent-subtle-fg',
  '--on-accent',
  '--bg',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-glass',
  '--scrim',
  '--on-hero',
  '--hero-from',
  '--hero-via',
  '--hero-to',
  '--text',
  '--text-secondary',
  '--border',
  '--focus-ring',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-7',
  '--space-8',
  '--radius-scale',
  '--density-scale',
  '--section-y',
  '--card-pad',
  '--gap-tight',
  '--gap',
  '--gap-loose',
  '--font-display',
  '--font-body',
  '--dur-fast',
  '--dur-normal',
  '--dur-slow',
  '--ease-standard',
  '--ease-emphasis',
  '--lift-y',
  '--scale-hover',
] as const;

/**
 * Engine extras: not part of the negotiated contract, but emitted so presets can express
 * themselves (bold's 2px borders, luxury's uppercase eyebrows) without inline magic numbers.
 * Names are deliberately outside the globals.css namespace so nothing existing is shadowed.
 */
export const EXTRA_TOKEN_NAMES = [
  '--border-w',
  '--fw-display',
  '--fw-body',
  '--fw-label',
  '--tracking-display',
  '--tracking-body',
  '--tracking-label',
  '--label-transform',
  '--hero-angle',
] as const;

export type LegacyTokenName = (typeof LEGACY_TOKEN_NAMES)[number];
export type NewTokenName = (typeof NEW_TOKEN_NAMES)[number];
