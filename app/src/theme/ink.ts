import { onColor } from './engine';

/**
 * The legible ink for text sitting on an arbitrary filled surface.
 *
 * Avatars and seat chips are filled with a per-staff colour, which `serviceColor.ts` resolves to
 * `primary` / `amber500` / `green500` / `secondary`. Those are all LIGHT colours in dark mode, so
 * the hardcoded `#fff` these used to carry scored around 2:1 — initials on an amber or teal chip
 * were effectively unreadable. `textOnBrand` is no help here either: it tracks the brand fill, not
 * whichever colour this particular staff member happens to own.
 *
 * `onColor` is the engine's own contrast picker, so this stays consistent with how the microsite
 * chooses ink for the same kind of surface.
 */
export function inkOn(fill: string): string {
  return onColor(fill);
}
