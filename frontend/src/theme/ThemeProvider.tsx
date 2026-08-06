'use client';

/**
 * ThemeProvider — client-side carrier for the *config*, never for the colours.
 *
 * WHY IT HOLDS NO COLOURS: the resolved tokens are already in the document as CSS custom
 * properties (see ThemeStyle). If this context also held them, every colour change would
 * re-render the subtree that reads it, and server and client would have two sources of truth
 * that can disagree. Instead the context carries the small, serialisable `ThemeConfig` —
 * preset / mode / brand / the four modifier axes — and anything that wants a colour reads
 * `var(--…)` from CSS, exactly as the static server render does.
 *
 * Consequence: switching mode is `setMode('dark')` → one attribute on the wrapper → the
 * browser re-matches the already-parsed dark block. No token recomputation, no re-render of
 * the 1700-line microsite.
 *
 * The provider is optional. `useThemeConfig()` falls back to the legacy parity config, so a
 * component can read the config without the tree being wrapped.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  type ModeId,
  type PresetId,
  type ThemeConfig,
} from './engine';

export interface ThemeContextValue {
  /** The normalised config. Never partial, never `undefined`. */
  config: ThemeConfig;
  /** Replace the whole config (normalised on the way in). */
  setConfig: (next: ThemeConfig | Partial<ThemeConfig>) => void;
  /** Convenience setters for the two axes a store-front actually toggles at runtime. */
  setMode: (mode: ModeId) => void;
  setPreset: (preset: PresetId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Raw value straight from the API (`site.theme`) is fine — it is normalised here. */
  config?: unknown;
  children: ReactNode;
}

export function ThemeProvider({ config, children }: ThemeProviderProps) {
  const initial = useMemo(() => normalizeThemeConfig(config), [config]);
  const [current, setCurrent] = useState<ThemeConfig>(initial);

  const setConfig = useCallback((next: ThemeConfig | Partial<ThemeConfig>) => {
    setCurrent((prev) => normalizeThemeConfig({ ...prev, ...next }, prev));
  }, []);

  const setMode = useCallback((mode: ModeId) => setConfig({ mode }), [setConfig]);
  const setPreset = useCallback((preset: PresetId) => setConfig({ preset }), [setConfig]);

  const value = useMemo<ThemeContextValue>(
    () => ({ config: current, setConfig, setMode, setPreset }),
    [current, setConfig, setMode, setPreset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the active config. Outside a provider this returns the frozen legacy config and
 * no-op setters, so callers never have to null-check.
 */
export function useThemeConfig(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const fallback = useMemo<ThemeContextValue>(
    () => ({
      config: LEGACY_THEME_CONFIG,
      setConfig: () => {},
      setMode: () => {},
      setPreset: () => {},
    }),
    [],
  );
  return ctx ?? fallback;
}
