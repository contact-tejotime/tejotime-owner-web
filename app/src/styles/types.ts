import type { SemanticColors, radius, shadow } from '@/theme/tokens';

export type ThemeStyleProps = {
  colors: SemanticColors;
  radius: typeof radius;
  shadow: typeof shadow;
};
