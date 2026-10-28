import { format, t } from '@/i18n';

import type { DueCustomerDTO, DueListDTO, DueStatus, FollowupBody } from './api';
import { seriesDay } from './series';

/**
 * "Due to come back" — the words each card prints, and the call list's optimistic edits
 * (docs/customer-due-list.md). owner-web's twin is `owner-web/src/lib/due.ts`; the strings live in
 * each app's i18n/en.json and say the same thing. Every date is a store-local "YYYY-MM-DD" from
 * the API — never worked out on the phone's clock.
 */

export const DUE_SECTIONS: { status: DueStatus; title: string }[] = [
  { status: 'overdue', title: t.customers.due.sectionOverdue },
  { status: 'due_soon', title: t.customers.due.sectionDueSoon },
  { status: 'lapsed', title: t.customers.due.sectionLapsed },
];

export function dueStatusLabel(status: DueStatus): string {
  return DUE_SECTIONS.find((s) => s.status === status)!.title;
}

/** "Usually every 15–25 days · last visit 19 days ago". */
export function dueRhythmLine(c: DueCustomerDTO): string {
  const rhythm = format(t.customers.due.rhythm, { min: c.bandMin, max: c.bandMax });
  const last =
    c.daysSinceLast === 1 ? t.customers.due.lastVisitOne : format(t.customers.due.lastVisit, { days: c.daysSinceLast });
  return `${rhythm} · ${last}`;
}

/** "Haircut + Hair Spa · with Lisa", the service alone, or null when the visit had neither. */
export function dueLastLine(c: DueCustomerDTO): string | null {
  if (c.lastServiceName && c.lastStaff) {
    return format(t.customers.due.lastWith, { service: c.lastServiceName, name: c.lastStaff.name });
  }
  return c.lastServiceName ?? (c.lastStaff ? c.lastStaff.name : null);
}

/** Why a hidden card is hidden: "Not interested", or "Call back Mon 26 Oct". */
export function dueHiddenLabel(c: DueCustomerDTO): string {
  if (c.hiddenReason === 'snoozed' && c.followup?.snoozeUntil) {
    return format(t.customers.due.reasonSnoozed, { date: seriesDay(c.followup.snoozeUntil) });
  }
  return t.customers.due.reasonNotInterested;
}

/** The booking picker opens on their expected day — or today, when that has passed. */
export function dueBookFrom(c: DueCustomerDTO, today: string): string {
  return c.expectedDate > today ? c.expectedDate : today;
}

/** The toast after logging a call: what happened, with Undo. */
export function dueLoggedMessage(body: FollowupBody): string {
  if (body.outcome === 'not_interested') return t.customers.due.hiddenNotInterested;
  if (body.outcome === 'no_answer') return t.customers.due.hiddenNoAnswer;
  return format(t.customers.due.hiddenUntil, { date: seriesDay(body.callBackOn) });
}

/** How many customers the Due switch counts (hidden ones are not "to call"). */
export function dueCount(list: DueListDTO | null): number {
  return list ? list.counts.overdue + list.counts.dueSoon + list.counts.lapsed : 0;
}

/**
 * The list with one customer moved to Hidden — what the screen shows while the API confirms a
 * logged call. The snooze day shown is the one the API will set ("no answer" → tomorrow, which is
 * the first day of `callBackRange`).
 */
export function hideDue(list: DueListDTO | null, customerId: string, body: FollowupBody): DueListDTO | null {
  if (!list) return list;
  const row = list.data.find((c) => c.customerId === customerId);
  if (!row) return list;
  const snoozeUntil =
    body.outcome === 'call_later' ? body.callBackOn : body.outcome === 'no_answer' ? list.callBackRange.min : null;
  const hidden: DueCustomerDTO = {
    ...row,
    hiddenReason: body.outcome === 'not_interested' ? 'not_interested' : 'snoozed',
    followup: { outcome: body.outcome, snoozeUntil, aboutLastVisit: row.lastVisitDate, updatedAt: new Date().toISOString() },
  };
  return {
    ...list,
    data: list.data.filter((c) => c.customerId !== customerId),
    hidden: [hidden, ...list.hidden.filter((c) => c.customerId !== customerId)],
    counts: { ...recount(list.data.filter((c) => c.customerId !== customerId)), hidden: list.counts.hidden + 1 },
  };
}

/** The list with one hidden customer back on it (Undo), in its section. */
export function restoreDue(list: DueListDTO | null, customerId: string): DueListDTO | null {
  if (!list) return list;
  const row = list.hidden.find((c) => c.customerId === customerId);
  if (!row) return list;
  const { hiddenReason: _gone, ...shown } = row;
  const data = [...list.data, { ...shown, followup: null }];
  return {
    ...list,
    data,
    hidden: list.hidden.filter((c) => c.customerId !== customerId),
    counts: { ...recount(data), hidden: Math.max(0, list.counts.hidden - 1) },
  };
}

/** The list without a customer who has just been booked. */
export function dropDue(list: DueListDTO | null, customerId: string): DueListDTO | null {
  if (!list) return list;
  const data = list.data.filter((c) => c.customerId !== customerId);
  const hidden = list.hidden.filter((c) => c.customerId !== customerId);
  return { ...list, data, hidden, counts: { ...recount(data), hidden: hidden.length } };
}

function recount(rows: DueCustomerDTO[]) {
  return {
    overdue: rows.filter((c) => c.status === 'overdue').length,
    dueSoon: rows.filter((c) => c.status === 'due_soon').length,
    lapsed: rows.filter((c) => c.status === 'lapsed').length,
  };
}
