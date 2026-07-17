import en from "./en.json";

/**
 * The single source of every user-facing string in the admin panel. Read it
 * directly for type-safe, autocompleted access that fails the build on a typo:
 *
 *   t.login.signIn            → "Sign in"
 *   format(t.stores.count, { count: 12 })
 *
 * It's a plain object, so it works identically in Server and Client Components
 * (no context/provider). To add another language later, add `fr.json` with the
 * same shape and select the dictionary here.
 */
export const t = en;

/** Fill `{placeholders}` in a template string: format(t.stores.filterCount, { shown, total }). */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : `{${key}}`));
}

/**
 * Pick the singular or plural template by `count`, then interpolate. `count` is
 * always available to the template as `{count}`.
 *   plural(n, t.stores.countOne, t.stores.count)  // "1 store" | "12 stores"
 */
export function plural(
  count: number,
  one: string,
  many: string,
  vars: Record<string, string | number> = {},
): string {
  return format(count === 1 ? one : many, { count, ...vars });
}
