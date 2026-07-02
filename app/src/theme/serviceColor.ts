import { ServiceColorToken } from '@/data/sample';

import { useTheme } from './ThemeProvider';

/** Resolve a service color token (from sample data) to a concrete theme color. */
export function useServiceColor() {
  const { colors } = useTheme();
  return (token: ServiceColorToken): string => {
    switch (token) {
      case 'primary':
        return colors.primary;
      case 'amber500':
        return colors.amber500;
      case 'green500':
        return colors.green500;
      case 'secondary':
      default:
        return colors.secondary;
    }
  };
}
