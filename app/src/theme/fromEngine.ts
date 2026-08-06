/**
 * Theme engine → React Native adapter.
 *
 * The engine is the same code the customer microsite runs (mirrored here by
 * scripts/sync-theme-engine.mjs), but it speaks CSS: it hands back a flat `--token` → value
 * map. React Native has no custom properties, so this file is where that map becomes the
 * `SemanticColors` / `radius` / `controlHeight` objects ThemeProvider already serves — which
 * means the 49 screens calling `useTheme()` need no change at all.
 *
 * PARITY: with no store theme, ThemeProvider keeps using the hand-written `lightColors` /
 * `darkColors` from tokens.ts. This adapter only ever runs once a business config has actually
 * been fetched, and for the default config it produces the same values anyway — the engine's
 * `minimal` preset is calibrated against those very tokens.
 *
 * Only the LEGACY token names are read here. The engine emits ~60 more (--brand-*, --surface-1,
 * --on-hero …); they are deliberately ignored until the app has components that want them.
 */

import {
  resolveTheme,
  type ModeId,
  type ResolvedTheme,
  type ThemeConfig,
  type TokenMap,
} from './engine';
import { darkColors, lightColors, radius as baseRadius, controlHeight as baseControlHeight } from './tokens';
import type { SemanticColors } from './tokens';

/** `10px` → `10`. The engine emits px strings; RN wants unitless numbers. */
function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Map the engine's legacy CSS tokens onto SemanticColors.
 *
 * `amber500`/`green500` are raw palette primitives rather than semantic roles — the engine has
 * no equivalent, so they stay on the base scale in both modes.
 */
export function colorsFromTokens(t: TokenMap, base: SemanticColors): SemanticColors {
  const pick = (name: string, fallback: string) => t[name] ?? fallback;
  return {
    surfacePage: pick('--surface-page', base.surfacePage),
    surfaceCard: pick('--surface-card', base.surfaceCard),
    surfaceSunken: pick('--surface-sunken', base.surfaceSunken),
    surfaceHover: pick('--surface-hover', base.surfaceHover),
    surfaceInverse: pick('--surface-inverse', base.surfaceInverse),

    textStrong: pick('--text-strong', base.textStrong),
    textBody: pick('--text-body', base.textBody),
    textMuted: pick('--text-muted', base.textMuted),
    textSubtle: pick('--text-subtle', base.textSubtle),
    textOnBrand: pick('--text-on-brand', base.textOnBrand),
    textLink: pick('--text-link', base.textLink),

    borderSubtle: pick('--border-subtle', base.borderSubtle),
    borderDefault: pick('--border-default', base.borderDefault),
    borderStrong: pick('--border-strong', base.borderStrong),
    borderFocus: pick('--border-focus', base.borderFocus),

    primary: pick('--primary', base.primary),
    primaryHover: pick('--primary-hover', base.primaryHover),
    primaryActive: pick('--primary-active', base.primaryActive),
    primarySoft: pick('--primary-soft', base.primarySoft),
    primarySoftFg: pick('--primary-soft-fg', base.primarySoftFg),

    secondary: pick('--secondary', base.secondary),
    secondaryHover: pick('--secondary-hover', base.secondaryHover),
    secondarySoft: pick('--secondary-soft', base.secondarySoft),
    secondarySoftFg: pick('--secondary-soft-fg', base.secondarySoftFg),

    success: pick('--success', base.success),
    successSoft: pick('--success-soft', base.successSoft),
    successSoftFg: pick('--success-soft-fg', base.successSoftFg),
    warning: pick('--warning', base.warning),
    warningSoft: pick('--warning-soft', base.warningSoft),
    warningSoftFg: pick('--warning-soft-fg', base.warningSoftFg),
    error: pick('--error', base.error),
    errorSoft: pick('--error-soft', base.errorSoft),
    errorSoftFg: pick('--error-soft-fg', base.errorSoftFg),
    info: pick('--info', base.info),
    infoSoft: pick('--info-soft', base.infoSoft),
    infoSoftFg: pick('--info-soft-fg', base.infoSoftFg),

    amber500: base.amber500,
    green500: base.green500,
  };
}

/**
 * tokens.ts declares `radius`/`controlHeight` `as const`, so their fields are literal types
 * (`md: 10`). A themed store produces different numbers, so the shape has to be widened. The
 * base objects still satisfy these, and consumers only ever read the values.
 */
export interface RadiusRN {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
  circle: '50%';
}

export interface ControlHeightRN {
  sm: number;
  md: number;
  lg: number;
}

export interface EngineTheme {
  colors: SemanticColors;
  radius: RadiusRN;
  controlHeight: ControlHeightRN;
  resolved: ResolvedTheme;
}

/**
 * Resolve a store's config into everything ThemeProvider needs for one mode.
 *
 * `mode` is the CONCRETE mode to paint — 'auto' has to be collapsed to light/dark by the
 * caller (RN has `useColorScheme()`; there is no media query to defer to).
 */
export function engineTheme(config: ThemeConfig, mode: 'light' | 'dark'): EngineTheme {
  const resolved = resolveTheme(config);
  const tokens = mode === 'dark' ? resolved.dark : resolved.light;
  const base = mode === 'dark' ? darkColors : lightColors;

  return {
    colors: colorsFromTokens(tokens, base),
    radius: {
      ...baseRadius,
      xs: num(tokens['--radius-xs'], baseRadius.xs),
      sm: num(tokens['--radius-sm'], baseRadius.sm),
      md: num(tokens['--radius-md'], baseRadius.md),
      lg: num(tokens['--radius-lg'], baseRadius.lg),
      xl: num(tokens['--radius-xl'], baseRadius.xl),
    },
    controlHeight: {
      sm: num(tokens['--control-h-sm'], baseControlHeight.sm),
      md: num(tokens['--control-h-md'], baseControlHeight.md),
      lg: num(tokens['--control-h-lg'], baseControlHeight.lg),
    },
    resolved,
  };
}

/** Collapse the stored mode against the OS scheme. Mirrors the microsite's `auto` behaviour. */
export function effectiveMode(mode: ModeId, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}
