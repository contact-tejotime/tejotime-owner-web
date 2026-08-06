import type { SemanticColors, shadow } from '@/theme/tokens';
import type { RadiusRN } from '@/theme/fromEngine';

export type ThemeStyleProps = {
  colors: SemanticColors;
  // Widened from `typeof radius` (which is `as const`, so `md: 10` is a literal type): a store
  // on the Rounded/Sharp setting resolves different numbers through the theme engine.
  radius: RadiusRN;
  shadow: typeof shadow;
};
