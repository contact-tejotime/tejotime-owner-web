import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { effectiveMode, engineTheme } from './fromEngine';
import type { ControlHeightRN, RadiusRN } from './fromEngine';
import type { ThemeConfig } from './engine';

import {
  controlHeight,
  darkColors,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  lightColors,
  lineHeight,
  motion,
  radius,
  ring,
  SemanticColors,
  shadow,
  space,
  textStyle,
} from './tokens';

type Theme = {
  dark: boolean;
  colors: SemanticColors;
  space: typeof space;
  radius: RadiusRN;
  controlHeight: ControlHeightRN;
  fontSize: typeof fontSize;
  fontFamily: typeof fontFamily;
  lineHeight: typeof lineHeight;
  letterSpacing: typeof letterSpacing;
  textStyle: typeof textStyle;
  layout: typeof layout;
  shadow: typeof shadow;
  ring: typeof ring;
  motion: typeof motion;
};

type ThemeContextValue = Theme & {
  setDark: (v: boolean) => void;
  toggleDark: () => void;
  /** The signed-in store's Appearance config; null until /business has been fetched. */
  themeConfig: ThemeConfig | null;
  /** Called once by AppStateProvider when the business loads. */
  setThemeConfig: (c: ThemeConfig | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialDark = false,
}: {
  children: React.ReactNode;
  initialDark?: boolean;
}) {
  // `null` = nobody has touched the Settings switch, so the store's own mode decides. Once the
  // owner flips it, their choice wins for the session — the switch has to keep working even
  // for a store whose Appearance is pinned to Light.
  const [manualDark, setManualDark] = useState<boolean | null>(null);
  // The signed-in store's Appearance config, once AppStateProvider has fetched /business.
  // Null until then — and null is the parity path: colours stay exactly the hand-written
  // lightColors/darkColors, so nothing changes for a store that never opened Appearance.
  const [themeConfig, setThemeConfig] = useState<ThemeConfig | null>(null);
  const systemScheme = useColorScheme();

  // 'auto' follows the OS here exactly as it follows prefers-color-scheme on the microsite.
  const configMode = themeConfig ? effectiveMode(themeConfig.mode, systemScheme === 'dark') : null;
  const isDark = manualDark ?? (configMode ? configMode === 'dark' : initialDark);
  const engine = useMemo(
    () => (themeConfig ? engineTheme(themeConfig, isDark ? 'dark' : 'light') : null),
    [themeConfig, isDark],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      dark: isDark,
      colors: engine ? engine.colors : isDark ? darkColors : lightColors,
      space,
      radius: engine ? engine.radius : radius,
      controlHeight: engine ? engine.controlHeight : controlHeight,
      fontSize,
      fontFamily,
      lineHeight,
      letterSpacing,
      textStyle,
      layout,
      shadow,
      ring,
      motion,
      setDark: setManualDark,
      toggleDark: () => setManualDark((d) => !(d ?? isDark)),
      themeConfig,
      setThemeConfig,
    }),
    [isDark, engine, themeConfig],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
