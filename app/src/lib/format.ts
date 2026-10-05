import { QueueEntry } from '@/data/sample';
import { t, format } from '@/i18n';
import { storeTimeLabel } from '@/lib/zoned';

/** Two-letter initials from a name. */
export function initials(name = ''): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

/** Trailing wait/status label shown on queue rows. */
export function waitLabel(c: Pick<QueueEntry, 'status' | 'wait'>): string {
  if (c.status === 'in-service') return t.format.inService;
  return c.wait ? format(t.format.waitMin, { wait: c.wait }) : '';
}

/**
 * Format appointment time strings for display — an instant on the STORE's clock (lib/zoned.ts);
 * an already-formatted label ("10:00 AM", from the mappers) as it is.
 */
export function formatAppointmentDate(value?: string | Date | null, fallback: string = t.common.dash): string {
  if (!value) return fallback;
  if (value instanceof Date) {
    return storeTimeLabel(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && trimmed.includes('-')) {
    return storeTimeLabel(parsed);
  }
  return trimmed;
}
