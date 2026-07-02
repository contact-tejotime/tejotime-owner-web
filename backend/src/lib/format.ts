/** Ported verbatim from app/src/lib/format.ts. */

/** Two-letter initials from a name. */
export function initials(name = ''): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
