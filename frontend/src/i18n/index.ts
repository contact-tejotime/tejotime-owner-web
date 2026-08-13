import en from "./en.json";

/**
 * The single source of every user-facing string in the public site. Read it
 * directly for type-safe, autocompleted access that fails the build on a typo:
 *
 *   t.landing.getStarted        → "Get started"
 *   format(t.queue.ahead, { count: 3 })
 *
 * It's a plain object, so it works identically in Server and Client Components
 * (no context/provider). To add another language later, add `fr.json` with the
 * same shape and select the dictionary here.
 */
export const t = en;

/** Fill `{placeholders}` in a template string: format(t.queue.ahead, { count }). */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : `{${key}}`));
}

/**
 * Pick the singular or plural template by `count`, then interpolate. `count` is
 * always available to the template as `{count}`.
 *   plural(n, t.queue.aheadOne, t.queue.ahead)  // "1 ahead" | "3 ahead"
 */
export function plural(
  count: number,
  one: string,
  many: string,
  vars: Record<string, string | number> = {},
): string {
  return format(count === 1 ? one : many, { count, ...vars });
}
