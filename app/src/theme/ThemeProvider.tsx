import React, { createContext, useContext, useMemo, useState } from 'react';

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
  radius: typeof radius;
  controlHeight: typeof controlHeight;
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
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialDark = false,
}: {
  children: React.ReactNode;
  initialDark?: boolean;
}) {
  const [dark, setDark] = useState(initialDark);

  const value = useMemo<ThemeContextValue>(
    () => ({
      dark,
      colors: dark ? darkColors : lightColors,
      space,
      radius,
      controlHeight,
      fontSize,
      fontFamily,
      lineHeight,
      letterSpacing,
      textStyle,
      layout,
      shadow,
      ring,
      motion,
      setDark,
      toggleDark: () => setDark((d) => !d),
    }),
    [dark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
