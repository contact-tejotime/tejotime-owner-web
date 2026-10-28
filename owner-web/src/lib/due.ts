import { format, t } from "@/i18n";

import { dateLabel } from "./series";
import type { DueCustomer, DueStatus } from "./server-api";

/**
 * "Due to come back" — the words each row prints (docs/customer-due-list.md). The app's twin is
 * `app/src/lib/due.ts`; the strings live in each app's i18n/en.json and say the same thing.
 * Every date here is a store-local "YYYY-MM-DD" from the API — never worked out on this clock.
 */

export const DUE_SECTIONS: { status: DueStatus; title: string }[] = [
  { status: "overdue", title: t.customers.due.sectionOverdue },
  { status: "due_soon", title: t.customers.due.sectionDueSoon },
  { status: "lapsed", title: t.customers.due.sectionLapsed },
];

export function dueStatusLabel(status: DueStatus): string {
  return DUE_SECTIONS.find((s) => s.status === status)!.title;
}

/** "Usually every 15–25 days · last visit 19 days ago". */
export function dueRhythmLine(c: DueCustomer): string {
  const rhythm = format(t.customers.due.rhythm, { min: c.bandMin, max: c.bandMax });
  const last =
    c.daysSinceLast === 1 ? t.customers.due.lastVisitOne : format(t.customers.due.lastVisit, { days: c.daysSinceLast });
  return `${rhythm} · ${last}`;
}

/** "Haircut + Hair Spa · with Lisa", the service alone, or null when the visit had neither. */
export function dueLastLine(c: DueCustomer): string | null {
  if (c.lastServiceName && c.lastStaff) {
    return format(t.customers.due.lastWith, { service: c.lastServiceName, name: c.lastStaff.name });
  }
  return c.lastServiceName ?? (c.lastStaff ? c.lastStaff.name : null);
}

/** Why a hidden row is hidden: "Not interested", or "Call back Mon 26 Oct". */
export function dueHiddenLabel(c: DueCustomer, zone: string): string {
  if (c.hiddenReason === "snoozed" && c.followup?.snoozeUntil) {
    return format(t.customers.due.reasonSnoozed, { date: dateLabel(c.followup.snoozeUntil, zone) });
  }
  return t.customers.due.reasonNotInterested;
}

/** The booking sheet starts on their expected day — or today, when that has passed. */
export function dueBookFrom(c: DueCustomer, today: string): string {
  return c.expectedDate > today ? c.expectedDate : today;
}
