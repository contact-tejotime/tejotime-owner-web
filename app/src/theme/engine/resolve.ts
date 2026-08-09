/**
 * resolveTheme() — config in, two complete token maps + a contrast report out.
 *
 * Shape of the work:
 *   1. normalise the config and build the brand/accent ramps,
 *   2. build the light token map and the dark token map independently (dark is a different
 *      palette, NOT an inversion — see DARK below),
 *   3. run every foreground/background pairing through ensureContrast on the way, and record
 *      each one so the admin UI can render an AA badge without recomputing anything.
 *
 * PARITY: with `LEGACY_THEME_CONFIG` every legacy token comes out byte-identical to
 * frontend/src/app/globals.css. That holds because each ensureContrast() call there already
 * passes its threshold and therefore returns its input untouched — the repair path only fires
 * for brands globals.css never anticipated. `__tests__/run.ts` asserts the whole map.
 *
 * DARK: the interactive brand step moves from ramp 600 to ramp 400 (a saturated 600 on
 * near-black fails contrast and buzzes), surfaces step UP in lightness from the page, tint
 * overlays are flattened to opaque hexes so contrast maths stays exact, and every scrim/glass
 * value is built from the dark neutral — never white alpha.
 */

import {
  contrastRatio,
  ensureContrast,
  onColor,
  onColorMulti,
  worstBackground,
} from './color/contrast';
import { mixSrgb, rgbaString } from './color/oklch';
import { generateRamp, rampToArray, rotatedRamp } from './color/ramp';
import { normalizeThemeConfig } from './defaults';
import { defaultHeroVariantFor } from './hero';
import { ANIMATION_SCALES, DENSITY_SCALES, RADIUS_SCALES, SHADOW_SCALES } from './modifiers';
import { getPreset } from './presets';
import { TYPE_SETS } from './typography';
import type {
  ColorRamp,
  ContrastCheck,
  ContrastReport,
  ContrastTier,
  EffectiveThemeConfig,
  HeroStop,
  ModeId,
  NeutralRamp,
  PresetDefinition,
  RampStop,
  ResolvedTheme,
  ShadowLayer,
  ThemeConfig,
  TokenMap,
} from './types';
import { NEUTRAL_STOPS, RAMP_STOPS } from './types';

/* ============================================================
   Constants that are NOT per-store
   ============================================================ */

/**
 * The TejoTime mark itself. Deliberately not derived from the store brand — it is our logo,
 * it appears in the nav tile gradient, and globals.css already pins these values. Constant in
 * both modes so nothing shifts when a visitor toggles theme.
 */
const BRAND_MARK_INK = '#102a6b';
const BRAND_MARK_ACCENT = '#f5821f';

/**
 * Status colours are semantic, not brand-derived: "error" must stay red on a red-branded
 * salon page. Light values are globals.css verbatim (`--green-600`/`--green-50`/`--green-700`
 * and friends), which is also what makes the parity test pass.
 */
const STATUS_LIGHT = {
  success: { base: '#16a34a', soft: '#f0fdf4', fg: '#15803d' },
  warning: { base: '#d97706', soft: '#fffbeb', fg: '#b45309' },
  error: { base: '#dc2626', soft: '#fef2f2', fg: '#b91c1c' },
  info: { base: '#2563eb', soft: '#eff6ff', fg: '#1d4ed8' },
} as const;

/** Dark bases are the 400 steps — 600-level status colours disappear against near-black. */
const STATUS_DARK_BASE = {
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#60a5fa',
} as const;

type StatusKey = keyof typeof STATUS_LIGHT;
const STATUS_KEYS: StatusKey[] = ['success', 'warning', 'error', 'info'];

/** Elevation shadows tinted with a near-black are invisible on a dark page; lift the alpha. */
const DARK_SHADOW_ALPHA_GAIN = 2.2;
const DARK_SHADOW_ALPHA_MAX = 0.75;

/* ============================================================
   Small helpers
   ============================================================ */

const px = (n: number) => `${n}px`;

/** Move along the ramp: +1 = one step darker, -1 = one step lighter. Clamped at both ends. */
function stepBy(stop: RampStop, delta: number): RampStop {
  const i = RAMP_STOPS.indexOf(stop);
  const j = Math.max(0, Math.min(RAMP_STOPS.length - 1, i + delta));
  return RAMP_STOPS[j];
}

/**
 * Which way the hover/pressed states walk along a ramp.
 *
 * The default is "darker in light mode, lighter in dark mode" — that is what globals.css does
 * (#2563eb → #1d4ed8 → #1e40af) and what parity depends on. But the interactive states keep
 * the SAME ink as the resting fill, and for a mid-light seed `onColor()` picks DARK ink; the
 * default direction then moves the fill towards that ink and the label falls off AA — measured
 * 2.62:1 on a pressed teal button, i.e. below even the 3:1 non-text floor.
 *
 * So: try the default, and only if one of its steps drops below `min` try the other way and
 * take whichever is better. Every combination that already passes — including the whole legacy
 * parity config, where the brand states are 6.70/8.72 and the accent state 4.77 — is returned
 * untouched, so this can never rewrite a value the live site ships.
 */
function stateDirection(
  ramp: ColorRamp,
  step: RampStop,
  ink: string,
  preferred: 1 | -1,
  deltas: readonly number[],
  min = 4.5,
): 1 | -1 {
  const worst = (dir: 1 | -1): number =>
    Math.min(...deltas.map((d) => contrastRatio(ink, ramp[stepBy(step, d * dir)])));
  const kept = worst(preferred);
  if (kept >= min) return preferred;
  const flipped: 1 | -1 = preferred === 1 ? -1 : 1;
  return worst(flipped) > kept ? flipped : preferred;
}

function neutralToArray(n: NeutralRamp): string[] {
  return NEUTRAL_STOPS.map((s) => n[s]);
}

function shadowCss(layers: ShadowLayer[], tint: string, alphaGain: number): string {
  if (layers.length === 0) return 'none';
  return layers
    .map((l) => {
      const parts = [fmtPx(l.x), fmtPx(l.y), fmtPx(l.blur)];
      if (l.spread !== undefined) parts.push(fmtPx(l.spread));
      const alpha = Math.min(DARK_SHADOW_ALPHA_MAX, l.alpha * alphaGain);
      return `${parts.join(' ')} ${rgbaString(tint, alpha)}`;
    })
    .join(', ');
}

/** `0` stays bare (globals.css writes `0 1px 2px …`, not `0px 1px 2px …`). */
const fmtPx = (n: number) => (n === 0 ? '0' : `${n}px`);

/* ============================================================
   Accent resolution
   ============================================================ */

interface AccentResolution {
  ramp: ColorRamp;
  /** Light-mode interactive step within `ramp`. */
  step: RampStop;
}

function resolveAccent(preset: PresetDefinition, config: ThemeConfig, brandRamp: ColorRamp): AccentResolution {
  // An explicit admin override always wins over the preset strategy.
  if (config.accent) {
    const ramp = generateRamp(config.accent);
    // A custom hex has no curated home step, so treat it like a brand: 600 is interactive.
    return { ramp, step: 600 };
  }

  const strategy = preset.accent;
  switch (strategy.kind) {
    case 'fixed':
      return { ramp: generateRamp(strategy.hex), step: strategy.step };
    case 'brand-step':
      return { ramp: brandRamp, step: strategy.step };
    case 'complementary':
      return {
        ramp: rotatedRamp(config.brand, strategy.hueShift, strategy.chromaBoost),
        step: strategy.step,
      };
  }
}

/* ============================================================
   Per-mode token build
   ============================================================ */

interface ModeBuild {
  tokens: TokenMap;
  checks: ContrastCheck[];
}

function buildMode(
  mode: 'light' | 'dark',
  config: EffectiveThemeConfig,
  preset: PresetDefinition,
  brandRamp: ColorRamp,
  accent: AccentResolution,
): ModeBuild {
  const isDark = mode === 'dark';
  const n = isDark ? preset.neutralsDark : preset.neutralsLight;
  const neutralArr = neutralToArray(n);
  const brandArr = rampToArray(brandRamp);
  const accentArr = rampToArray(accent.ramp);

  const checks: ContrastCheck[] = [];
  const check = (
    id: string,
    label: string,
    tier: ContrastTier,
    fg: string,
    bg: string,
  ): void => {
    const min = tier === 'body' ? 4.5 : tier === 'decorative' ? 1 : 3;
    const ratio = contrastRatio(fg, bg);
    checks.push({
      id: `${mode}/${id}`,
      label,
      tier,
      fg,
      bg,
      ratio: Math.round(ratio * 100) / 100,
      min,
      pass: ratio >= min,
    });
  };

  /* ---- Surfaces & neutrals ------------------------------------------------ */
  // Light: surfaces come off the light end and text off the dark end. Dark: the reverse,
  // and the four dark steps (900/800/700/600) are what the dark ramps are tuned to provide.
  const bg = isDark ? n[900] : n[50];
  const surface1 = isDark ? n[800] : n[0];
  const surface2 = isDark ? n[700] : n[100];
  /**
   * DECORATIVE / FILL-ONLY. `--surface-3` is for rails, tracks, skeletons and chips — never a
   * backdrop for body copy, and it is deliberately NOT in `textBackdrops` below, so no text
   * token is gated against it. Do not put `var(--text-muted)` on it; use `--surface-2`, which
   * IS gated (outside `minimal` — see below). Documented in docs/18-theming-architecture.md.
   */
  const surface3 = isDark ? n[600] : n[200];
  const surfaceHover = isDark ? n[700] : n[100];
  const surfaceInverse = isDark ? n[50] : n[900];
  const surfaceGlass = rgbaString(isDark ? n[800] : n[0], 0.72);
  const scrim = rgbaString(n[900], isDark ? 0.62 : 0.5);

  /**
   * Text backdrops.
   *
   * `minimal` gates against the page and the card ONLY. globals.css makes the same assumption,
   * and gating on `--surface-2` there would push `--text-muted` off slate-500 (#64748b on
   * #f1f5f9 is 4.34:1) — i.e. silently rewrite a token every live microsite already ships.
   * That pairing IS rendered (the microsite puts muted text on sunken wells), so it is a real
   * shortfall, but it is parity-locked and must be fixed in the markup, not here.
   *
   * Every OTHER preset is new, carries no parity constraint, and therefore gates on the sunken
   * surface too — which is what keeps `modern` (#71717a→#52525b) and `warm` (#8a6a4b→#6b5138,
   * dark #a98a68→#c5a888) from shipping 4.28–4.40:1 muted text. `--text-body`/`--text-strong`
   * are unaffected in all six presets; only `--text-muted` moves.
   */
  const gatesSunken = preset.id !== 'minimal';
  const textBackdrops = gatesSunken ? [bg, surface1, surface2] : [bg, surface1];
  const fixText = (hex: string, min = 4.5) =>
    ensureContrast(hex, worstBackground(hex, textBackdrops), min, neutralArr);

  const textStrong = fixText(isDark ? n[0] : n[900]);
  const textBody = fixText(isDark ? n[100] : n[700]);
  const textMuted = fixText(isDark ? n[300] : n[500]);
  // Placeholders, dividers, disabled meta. Decorative by design — see ContrastTier.
  const textSubtle = n[400];

  const borderSubtle = isDark ? n[700] : n[200];
  const borderDefault = isDark ? n[600] : n[300];
  const borderStrong = isDark ? n[500] : n[400];

  /* ---- Brand -------------------------------------------------------------- */
  const brandStep: RampStop = isDark ? 400 : 600;
  // The fill is the owner's colour, untouched. Darkening it to clear the 3:1 non-text minimum
  // (what this used to do) makes the brand picker lie — #FF5A5F came back as #d43641. WCAG
  // 1.4.11 wants the control's BOUNDARY to be perceivable, not the fill specifically, so a pale
  // brand keeps its fill and gets `--brand-outline` instead; the ink flips to dark via onColor.
  const brand = brandRamp[brandStep];
  // Hardest backdrop the fill sits on (page vs card) — the outline has to clear both.
  const fillBackdrop = contrastRatio(brand, bg) <= contrastRatio(brand, surface1) ? bg : surface1;
  const brandOutlined = ensureContrast(brand, fillBackdrop, 3, brandArr);
  const brandOutline = brandOutlined === brand ? 'transparent' : brandOutlined;
  // The ink is resolved BEFORE the interactive states, because it decides which way they walk
  // — hovering and pressing must not carry the label out of contrast. See stateDirection().
  // `brandInk` lets the owner force white/dark; contrast checks still report the real ratio.
  let onBrand = ensureContrast(onColor(brand, '#ffffff', n[900]), brand, 4.5);
  if (config.brandInk === 'white') onBrand = '#ffffff';
  else if (config.brandInk === 'dark') onBrand = '#0f172a';
  const brandDir = stateDirection(brandRamp, brandStep, onBrand, isDark ? -1 : 1, [1, 2]);
  const brandHover = brandRamp[stepBy(brandStep, brandDir)];
  const brandPressed = brandRamp[stepBy(brandStep, brandDir * 2)];
  const brandSubtle = isDark ? mixSrgb(surface1, brandRamp[400], 0.18) : brandRamp[50];
  const brandBorder = isDark ? mixSrgb(surface1, brandRamp[400], 0.4) : brandRamp[200];
  const brandSubtleFgSeed = isDark ? brandRamp[300] : brandRamp[stepBy(brandStep, 1)];
  const brandSubtleFg = ensureContrast(brandSubtleFgSeed, brandSubtle, 4.5, brandArr);

  /* ---- Accent ------------------------------------------------------------- */
  const accentStep: RampStop = isDark ? stepBy(accent.step, -2) : accent.step;
  const accentColor = accent.ramp[accentStep];
  // Same ink-first ordering as the brand — `warm`'s fixed orange put its dark ink at 4.11:1 on
  // the default (darker) hover step, which is the exact defect stateDirection() exists to fix.
  const onAccent = ensureContrast(onColor(accentColor, '#ffffff', n[900]), accentColor, 4.5);
  const accentDir = stateDirection(accent.ramp, accentStep, onAccent, isDark ? -1 : 1, [1]);
  const accentHover = accent.ramp[stepBy(accentStep, accentDir)];
  const accentSubtle = isDark ? mixSrgb(surface1, accent.ramp[accentStep], 0.18) : accent.ramp[50];
  const accentSubtleFgSeed = isDark
    ? accent.ramp[stepBy(accentStep, -1)]
    : accent.ramp[stepBy(accentStep, 1)];
  const accentSubtleFg = ensureContrast(accentSubtleFgSeed, accentSubtle, 4.5, accentArr);

  /* ---- Links & focus ------------------------------------------------------ */
  const textLink = ensureContrast(brandRamp[brandStep], bg, 4.5, brandArr);
  const focusRing = ensureContrast(brandRamp[brandStep], bg, 3, brandArr);

  /* ---- Status ------------------------------------------------------------- */
  const status: Record<StatusKey, { base: string; soft: string; fg: string }> = {
    success: STATUS_LIGHT.success,
    warning: STATUS_LIGHT.warning,
    error: STATUS_LIGHT.error,
    info: STATUS_LIGHT.info,
  };
  if (isDark) {
    for (const key of STATUS_KEYS) {
      const base = STATUS_DARK_BASE[key];
      // Flatten what would have been rgba(base, .18) over the card into an opaque hex, so the
      // soft-fg contrast check is measuring the colour that is actually painted.
      const soft = mixSrgb(surface1, base, 0.18);
      status[key] = { base, soft, fg: ensureContrast(base, soft, 4.5) };
    }
  } else {
    for (const key of STATUS_KEYS) {
      const s = STATUS_LIGHT[key];
      status[key] = { base: s.base, soft: s.soft, fg: ensureContrast(s.fg, s.soft, 4.5) };
    }
  }

  /* ---- Hero --------------------------------------------------------------- */
  const rampFor = (stop: HeroStop): string[] =>
    stop.from === 'brand' ? brandArr : stop.from === 'accent' ? accentArr : neutralArr;

  const resolveStop = (stop: HeroStop): string => {
    let hex: string;
    switch (stop.from) {
      case 'literal':
        hex = stop.hex ?? bg;
        break;
      case 'brand':
        hex = brandRamp[(stop.step ?? 600) as RampStop] ?? brand;
        break;
      case 'accent':
        hex = accent.ramp[(stop.step ?? 600) as RampStop] ?? accentColor;
        break;
      case 'neutral':
      default:
        hex = n[(stop.step ?? 900) as keyof NeutralRamp] ?? bg;
        break;
    }
    return stop.towardBg ? mixSrgb(hex, bg, stop.towardBg) : hex;
  };

  const heroRecipe = isDark ? preset.hero.dark : preset.hero.light;
  const rawStops = heroRecipe.map(resolveStop);
  // Pick the label colour against the worst stop, then push the STOPS (not the label) until
  // all three clear AA. Deepening a gradient is invisible; flipping a hero headline to dark
  // ink because one stop was 0.2 short is not.
  const heroFgSeed = onColorMulti(rawStops, '#ffffff', n[900]);
  const heroStops = rawStops.map((hex, i) =>
    ensureContrast(hex, heroFgSeed, 4.5, rampFor(heroRecipe[i])),
  );
  const onHero = ensureContrast(heroFgSeed, worstBackground(heroFgSeed, heroStops), 4.5);

  /* ---- Modifier scales ---------------------------------------------------- */
  const radius = RADIUS_SCALES[config.radius];
  const shadow = SHADOW_SCALES[config.shadow];
  const density = DENSITY_SCALES[config.density];
  const motion = ANIMATION_SCALES[config.animation];
  const type = TYPE_SETS[preset.typeSet];
  const shadowTint = n[900];
  const gain = isDark ? DARK_SHADOW_ALPHA_GAIN : 1;

  /* ---- Contrast report ---------------------------------------------------- */
  check('text-strong-on-bg', 'Headings on page', 'body', textStrong, bg);
  check('text-strong-on-surface-1', 'Headings on card', 'body', textStrong, surface1);
  check('text-body-on-bg', 'Body text on page', 'body', textBody, bg);
  check('text-body-on-surface-1', 'Body text on card', 'body', textBody, surface1);
  check('text-muted-on-bg', 'Muted text on page', 'body', textMuted, bg);
  check('text-muted-on-surface-1', 'Muted text on card', 'body', textMuted, surface1);
  check('text-link-on-bg', 'Links on page', 'body', textLink, bg);
  if (gatesSunken) {
    check('text-muted-on-surface-2', 'Muted text on sunken well', 'body', textMuted, surface2);
    check('text-body-on-surface-2', 'Body text on sunken well', 'body', textBody, surface2);
  }
  check('on-brand-on-brand', 'Label on primary button', 'body', onBrand, brand);
  // The button keeps one ink across all three states, so hover and pressed are separate pairs.
  // Without these two the direction bug in stateDirection() was invisible to the AA badge.
  check('on-brand-on-brand-hover', 'Label on primary button (hover)', 'body', onBrand, brandHover);
  check('on-brand-on-brand-pressed', 'Label on primary button (pressed)', 'body', onBrand, brandPressed);
  check('on-accent-on-accent', 'Label on accent', 'body', onAccent, accentColor);
  check('on-accent-on-accent-hover', 'Label on accent (hover)', 'body', onAccent, accentHover);
  check('brand-subtle-fg-on-brand-subtle', 'Text on brand chip', 'body', brandSubtleFg, brandSubtle);
  check('accent-subtle-fg-on-accent-subtle', 'Text on accent chip', 'body', accentSubtleFg, accentSubtle);
  for (const key of STATUS_KEYS) {
    check(`${key}-soft-fg-on-${key}-soft`, `Text on ${key} chip`, 'body', status[key].fg, status[key].soft);
    check(`${key}-on-surface-1`, `${key} indicator on card`, 'ui', status[key].base, surface1);
    // Status dots/bars sit on the page as often as on a card, and the page is the LIGHTER of
    // the two backdrops for a light theme — i.e. the harder pair. `luxury`'s cream was 2.98:1
    // against #d97706 with only the card checked, which is why its neutral-50 moved.
    check(`${key}-on-bg`, `${key} indicator on page`, 'ui', status[key].base, bg);
  }
  heroStops.forEach((stop, i) => {
    check(`on-hero-stop-${i + 1}`, `Hero text over stop ${i + 1}`, 'body', onHero, stop);
  });
  // What has to be perceivable is the button's edge, so a pale brand is judged on its outline
  // (which components paint via --brand-outline) rather than on the untouched fill.
  const brandEdge = brandOutline === 'transparent' ? brand : brandOutline;
  check('brand-edge-on-bg', 'Primary button edge on page', 'ui', brandEdge, bg);
  check('brand-edge-on-surface-1', 'Primary button edge on card', 'ui', brandEdge, surface1);
  check('focus-ring-on-bg', 'Focus ring on page', 'ui', focusRing, bg);
  // Reported, never gated — see ContrastTier in types.ts. Gating these would move values the
  // live site already ships (#94a3b8 on #f8fafc = 2.48, #14b8a6 on #ffffff = 2.49).
  check('text-subtle-on-bg', 'Placeholder text on page', 'decorative', textSubtle, bg);
  check('accent-on-surface-1', 'Accent fill on card', 'decorative', accentColor, surface1);
  check('border-default-on-surface-1', 'Default border on card', 'decorative', borderDefault, surface1);

  /* ---- Token map ---------------------------------------------------------- */
  const tokens: TokenMap = {
    /* --- brand scale (new) --- */
    ...RAMP_STOPS.reduce<TokenMap>((acc, s) => {
      acc[`--brand-${s}`] = brandRamp[s];
      return acc;
    }, {}),
    '--brand': brand,
    '--brand-hover': brandHover,
    '--brand-pressed': brandPressed,
    '--brand-subtle': brandSubtle,
    '--brand-subtle-fg': brandSubtleFg,
    '--brand-border': brandBorder,
    // `transparent` whenever the fill already reads as a control on its own; otherwise a darker
    // ramp step components put on the button's edge so a pale brand still delineates.
    '--brand-outline': brandOutline,
    '--on-brand': onBrand,

    /* --- accent (new) --- */
    '--accent': accentColor,
    '--accent-hover': accentHover,
    '--accent-subtle': accentSubtle,
    '--accent-subtle-fg': accentSubtleFg,
    '--on-accent': onAccent,

    /* --- surfaces (new) --- */
    '--bg': bg,
    '--surface-1': surface1,
    '--surface-2': surface2,
    '--surface-3': surface3,
    '--surface-glass': surfaceGlass,
    '--scrim': scrim,

    /* --- hero (new) --- */
    '--hero-from': heroStops[0],
    '--hero-via': heroStops[1],
    '--hero-to': heroStops[2],
    '--on-hero': onHero,
    '--hero-angle': preset.hero.angle,

    /* --- text & border (new) --- */
    '--text': textStrong,
    '--text-secondary': textBody,
    '--border': borderSubtle,
    '--focus-ring': focusRing,

    /* --- legacy colour aliases --- */
    '--primary': brand,
    '--primary-hover': brandHover,
    '--primary-active': brandPressed,
    '--primary-soft': brandSubtle,
    '--primary-soft-fg': brandSubtleFg,
    '--secondary': accentColor,
    '--secondary-hover': accentHover,
    '--secondary-soft': accentSubtle,
    '--secondary-soft-fg': accentSubtleFg,

    '--surface-page': bg,
    '--surface-card': surface1,
    '--surface-sunken': surface2,
    '--surface-hover': surfaceHover,
    '--surface-inverse': surfaceInverse,

    '--text-strong': textStrong,
    '--text-body': textBody,
    '--text-muted': textMuted,
    '--text-subtle': textSubtle,
    '--text-on-brand': onBrand,
    '--text-link': textLink,

    '--border-subtle': borderSubtle,
    '--border-default': borderDefault,
    '--border-strong': borderStrong,
    '--border-focus': focusRing,

    '--success': status.success.base,
    '--success-soft': status.success.soft,
    '--success-soft-fg': status.success.fg,
    '--warning': status.warning.base,
    '--warning-soft': status.warning.soft,
    '--warning-soft-fg': status.warning.fg,
    '--error': status.error.base,
    '--error-soft': status.error.soft,
    '--error-soft-fg': status.error.fg,
    '--info': status.info.base,
    '--info-soft': status.info.soft,
    '--info-soft-fg': status.info.fg,

    '--brand-ink': BRAND_MARK_INK,
    '--brand-accent': BRAND_MARK_ACCENT,

    /* --- radius --- */
    '--radius-xs': px(radius.xs),
    '--radius-sm': px(radius.sm),
    '--radius-md': px(radius.md),
    '--radius-lg': px(radius.lg),
    '--radius-xl': px(radius.xl),
    '--radius-pill': px(radius.pill),
    // Unitless multipliers for styles that still hardcode px. See RadiusScale.scale.
    '--radius-scale': String(radius.scale),

    /* --- elevation --- */
    '--shadow-xs': shadowCss(shadow.xs, shadowTint, gain),
    '--shadow-sm': shadowCss(shadow.sm, shadowTint, gain),
    '--shadow-md': shadowCss(shadow.md, shadowTint, gain),
    '--shadow-lg': shadowCss(shadow.lg, shadowTint, gain),
    '--shadow-xl': shadowCss(shadow.xl, shadowTint, gain),
    // Ring is brand-tinted and never alpha-boosted — it must look the same in both modes.
    '--ring': shadowCss(shadow.ring, brand, 1),

    /* --- density --- */
    '--control-h-sm': px(density.controlH.sm),
    '--control-h-md': px(density.controlH.md),
    '--control-h-lg': px(density.controlH.lg),
    '--space-1': px(density.space[0]),
    '--space-2': px(density.space[1]),
    '--space-3': px(density.space[2]),
    '--space-4': px(density.space[3]),
    '--space-5': px(density.space[4]),
    '--space-6': px(density.space[5]),
    '--space-7': px(density.space[6]),
    '--space-8': px(density.space[7]),
    '--section-y': density.sectionY,
    '--card-pad': px(density.cardPad),
    '--density-scale': String(density.scale),
    '--gap-tight': px(density.gapTight),
    '--gap': px(density.gap),
    '--gap-loose': px(density.gapLoose),

    /* --- typography --- */
    '--font-display': type.display,
    '--font-body': type.body,
    // Override the legacy name too. MicrositeClient names `var(--font-sans)` in ~100 inline
    // styles, so without this the preset's face reached only the handful of places using the
    // new tokens. Scoped to [data-tt-theme], so globals.css and the landing page are untouched.
    '--font-sans': type.body,
    '--fw-display': type.weightDisplay,
    '--fw-body': type.weightBody,
    '--fw-label': type.weightLabel,
    '--tracking-display': type.trackingDisplay,
    '--tracking-body': type.trackingBody,
    '--tracking-label': type.trackingLabel,
    '--label-transform': type.labelTransform,

    /* --- motion --- */
    '--dur-fast': motion.durFast,
    '--dur-normal': motion.durNormal,
    '--dur-slow': motion.durSlow,
    '--ease-standard': motion.easeStandard,
    '--ease-emphasis': motion.easeEmphasis,
    '--lift-y': motion.liftY,
    '--scale-hover': motion.scaleHover,

    /* --- structure --- */
    '--border-w': preset.borderWidth,
  };

  return { tokens, checks };
}

/* ============================================================
   Public entry point
   ============================================================ */

/**
 * Resolve a (possibly untrusted) theme config into both token maps plus a contrast report.
 *
 * Pure and deterministic: same config in, same object out, no caching, no globals. Cheap
 * enough (sub-millisecond) to call per request in an RSC; memoise upstream if you like.
 */
export function resolveTheme(config: ThemeConfig): ResolvedTheme {
  const normalized = normalizeThemeConfig(config);
  const preset = getPreset(normalized.preset);

  // Preset defaults fill the axes the admin never touched. Explicit values always win, and
  // survive a preset change — that is why the four keys are optional on ThemeConfig.
  const effective: EffectiveThemeConfig = {
    ...normalized,
    radius: normalized.radius ?? preset.defaults.radius,
    shadow: normalized.shadow ?? preset.defaults.shadow,
    density: normalized.density ?? preset.defaults.density,
    animation: normalized.animation ?? preset.defaults.animation,
    heroVariant: normalized.heroVariant ?? defaultHeroVariantFor(preset.id),
    brandInk: normalized.brandInk ?? 'auto',
  };

  const brandRamp = generateRamp(effective.brand);
  const accent = resolveAccent(preset, effective, brandRamp);

  const light = buildMode('light', effective, preset, brandRamp, accent);
  const dark = buildMode('dark', effective, preset, brandRamp, accent);

  const all = [...light.checks, ...dark.checks];
  const failures = all.filter((c) => !c.pass);
  const contrast: ContrastReport = {
    light: light.checks,
    dark: dark.checks,
    pass: failures.length === 0,
    failures,
  };

  return {
    config: effective,
    preset,
    heroVariant: effective.heroVariant,
    brandRamp,
    accentRamp: accent.ramp,
    light: light.tokens,
    dark: dark.tokens,
    contrast,
  };
}

/**
 * Convenience for callers that already know which mode they are painting.
 * `auto` resolves to the light map — it is the base block in the emitted CSS, and the
 * `prefers-color-scheme` override is applied by the stylesheet, not by JS.
 */
export function tokensForMode(resolved: ResolvedTheme, mode: ModeId): TokenMap {
  return mode === 'dark' ? resolved.dark : resolved.light;
}
