import { QueueEntry } from '@/data/sample';

/** Two-letter initials from a name. */
export function initials(name = ''): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

/** Trailing wait/status label shown on queue rows. */
export function waitLabel(c: Pick<QueueEntry, 'status' | 'wait'>): string {
  if (c.status === 'in-service') return 'In service';
  return c.wait ? `~${c.wait} min wait` : '';
}
