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

/** Format appointment time strings for display. */
export function formatAppointmentDate(value?: string | Date | null, fallback = '—'): string {
  if (!value) return fallback;
  if (value instanceof Date) {
    return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && trimmed.includes('-')) {
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return trimmed;
}
