import { contrastRatio, onColor } from './engine';

const WHITE = '#ffffff';

/**
 * White text stays on a coloured fill while it reaches this contrast: WCAG's minimum for large
 * text and interface elements (3:1).
 *
 * The engine's `onColor` simply takes whichever of white or near-black scores higher, and for a
 * mid-tone brand that is near-black: an orange like #E0612C scores 3.55 with white and 5.03 with
 * black. Owners read black-on-brand as wrong: black numbers on the Home card, and a navy "Add
 * walk-in" button on an orange store, "not in line with my theme". So white wins wherever it is
 * still readable (orange, green, teal and every darker brand), and only pale fills (amber, yellow,
 * sky), where white drops to ~2:1, keep dark ink. Dark mode is covered by the same rule: the engine
 * lightens the brand there, and white falls under 3:1 on it.
 */
export const WHITE_INK_MIN_CONTRAST = 3;

/** White on `fill` when it is readable (see WHITE_INK_MIN_CONTRAST), otherwise the engine's pick. */
export function preferWhiteOn(fill: string): string {
  return contrastRatio(WHITE, fill) >= WHITE_INK_MIN_CONTRAST ? WHITE : onColor(fill);
}

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
  return preferWhiteOn(fill);
}

/**
 * `color` at `alpha` opacity: for washes and hairlines drawn over a filled surface.
 *
 * The Home hero sits on the store's own brand colour, so its dividers and secondary buttons are
 * derived from the brand's *ink* rather than a fixed white. In dark mode the engine lightens the
 * brand and the ink turns dark, and a hardcoded white wash would all but vanish there.
 *
 * Handles `#rgb`, `#rrggbb` and the literal `white` / `black` an owner's brand-ink preference can
 * carry. Anything else is returned as-is (opaque) rather than guessed at.
 */
export function withAlpha(color: string, alpha: number): string {
  const named: Record<string, string> = { white: '#ffffff', black: '#000000' };
  let hex = (named[color.trim().toLowerCase()] ?? color).trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
