/** Working-hours view models + converters between API time strings and 12h labels. */

export type DayHoursVM = {
  /** 0 = Sunday … 6 = Saturday (backend convention). */
  dayOfWeek: number;
  day: string;
  open: boolean;
  /** 12h labels, e.g. '9:00 AM'. */
  from: string;
  to: string;
};

export type ApiHour = {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Monday-first display order of dayOfWeek values. */
export const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_FROM = '9:00 AM';
const DEFAULT_TO = '9:00 PM';

/** '6:00 AM' … '11:30 PM' in 30-minute steps. */
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 23; h++) {
    for (const m of ['00', '30']) {
      out.push(`${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`);
    }
  }
  return out;
})();

/** 'HH:MM' or 'HH:MM:SS' → 'h:MM AM/PM'. */
export function to12h(t: string): string {
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${mStr ?? '00'} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 'h:MM AM/PM' → 'HH:MM'. */
export function to24h(label: string): string {
  const m = label.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return label;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** API hours[] → 7 display rows (Monday-first); missing days become closed with editable defaults. */
export function mapHours(apiHours: ApiHour[]): DayHoursVM[] {
  const byDay = new Map<number, ApiHour>();
  for (const h of apiHours ?? []) byDay.set(h.dayOfWeek, h);
  return DISPLAY_ORDER.map((dow) => {
    const h = byDay.get(dow);
    const open = !!h && !h.isClosed && !!h.opensAt && !!h.closesAt;
    return {
      dayOfWeek: dow,
      day: DAY_NAMES[dow],
      open,
      from: open ? to12h(h!.opensAt!) : DEFAULT_FROM,
      to: open ? to12h(h!.closesAt!) : DEFAULT_TO,
    };
  });
}

export function toApiHours(hours: DayHoursVM[]): ApiHour[] {
  return hours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    opensAt: h.open ? to24h(h.from) : null,
    closesAt: h.open ? to24h(h.to) : null,
    isClosed: !h.open,
  }));
}

/** e.g. '6 days a week · 9:00 AM – 9:00 PM' for the settings list subtitle. */
export function hoursSummary(hours?: DayHoursVM[]): string {
  const open = (hours ?? []).filter((h) => h.open);
  if (!open.length) return 'Set your hours';
  const first = open[0];
  return `${open.length} days a week · ${first.from} – ${first.to}`;
}
