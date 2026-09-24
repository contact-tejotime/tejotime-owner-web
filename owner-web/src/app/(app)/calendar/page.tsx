import "@/styles/calendar.css";

import { redirect } from "next/navigation";
import { t, plural } from "@/i18n";

import { AppPageHeader } from "@/components/AppPageHeader";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import { can, NO_ACCESS } from "@/lib/roles";
import { getAppointmentsFresh, getBusiness, getMe, getStaff } from "@/lib/server-api";

import { CalendarMonth, type CalendarCell, type CalendarItem } from "./CalendarMonth";

/** Sunday-start grid covering the month (6×7), same shape as the app's calendar. */
const GRID_CELLS = 42;

/**
 * The store's own clock, not the server's. This page renders on Railway (UTC), and it used to
 * group bookings by `scheduledStartAt.slice(0, 10)` — the UTC date — and print times in the
 * server's zone, so an IST store saw a 10:00 booking as 4:30 AM and anything before 05:30 on the
 * previous day. Same default and same fallback as Home's greeting.
 */
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function safeZone(zone: string | null | undefined): string {
  if (!zone) return DEFAULT_TIMEZONE;
  // An unknown zone name throws; a bad value in the store's settings must not take the page down.
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymKey(year: number, month: number): string {
  return `${year}-${pad2(month + 1)}`;
}

/**
 * Grid dates are pure calendar arithmetic done in UTC, so neither the server's zone nor DST can
 * shift a cell: `Date.UTC` normalises overflow (day 0, day 32) and `getUTC*` reads it back.
 */
function buildGrid(year: number, month: number): Date[] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return Array.from({ length: GRID_CELLS }, (_, i) => new Date(Date.UTC(year, month, 1 - lead + i)));
}

function utcKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseYm(raw: string | undefined): { year: number; month: number } | null {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return { year: y, month: m - 1 };
}

/** `?from&to` for a month's 42-day grid. */
function rangeQuery(year: number, month: number): string {
  const grid = buildGrid(year, month);
  return `?from=${utcKey(grid[0])}&to=${utcKey(grid[grid.length - 1])}`;
}

/**
 * Month calendar, the same screen as the app's Calendar tab: month navigation, a 6×7 grid with a
 * dot under every day that has a booking, and the chosen day's bookings in the app's day sheet
 * (a bottom sheet on a phone, a docked panel beside the grid on wider screens — see
 * CalendarMonth). Data is `GET /appointments?from&to` over the visible 42-day grid, under the
 * backend's 45-day range cap, so a lead/trail day can be opened without another fetch.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; d?: string }>;
}) {
  const params = await searchParams;
  const requestedYm = parseYm(params.ym);

  // An explicit month (every month step carries one) fixes the range without knowing the store's
  // zone, so its bookings load alongside the session instead of after it. Only a bare /calendar
  // has to learn the zone first to know which month "now" is. Staff names are only for the
  // "Haircut · John" line. The bookings read is uncached on purpose: it is chair-scoped for
  // staff (see getAppointmentsFresh).
  const [me, staff, early] = await Promise.all([
    getMe(),
    getStaff(),
    requestedYm ? getAppointmentsFresh(rangeQuery(requestedYm.year, requestedYm.month)) : Promise.resolve(undefined),
  ]);
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  // GET /business is profile-gated. Without it the page falls back to the default zone — the
  // same trade Home makes for its greeting.
  const business = can(access, "profile") ? await getBusiness() : null;
  const zone = safeZone(business?.timezone);

  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const keyInZone = (d: Date) => {
    const parts = dayKeyFmt.formatToParts(d);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };

  const todayKey = keyInZone(new Date());
  const { year, month } = requestedYm ?? {
    year: Number(todayKey.slice(0, 4)),
    month: Number(todayKey.slice(5, 7)) - 1,
  };
  const ym = ymKey(year, month);
  const grid = buildGrid(year, month);
  const from = utcKey(grid[0]);
  const to = utcKey(grid[grid.length - 1]);

  const res = early !== undefined ? early : await getAppointmentsFresh(rangeQuery(year, month));

  const staffNames = new Map((staff?.data ?? []).map((s) => [s.id, s.name]));
  const canCheckIn = can(access, "appointments", "manage");
  // The app lands on Home after a check-in, where the queue is. A login that cannot open Home
  // stays here and sees the booking turn "Checked in" instead.
  const afterCheckInHref = can(access, "dashboard") || can(access, "queue") ? "/dashboard" : null;

  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });

  const sorted = [...(res?.data ?? [])].sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
  const itemsByDay: Record<string, CalendarItem[]> = {};
  let inMonthCount = 0;
  for (const a of sorted) {
    const start = new Date(a.scheduledStartAt);
    if (Number.isNaN(start.getTime())) continue;
    const key = keyInZone(start);
    if (key.startsWith(ym)) inMonthCount += 1;
    const staffName = a.staffId ? staffNames.get(a.staffId) : undefined;
    const service = a.serviceName ?? t.calendar.noService;
    // Only a booking still waiting to arrive can be checked in — the app's CHECK_IN_ELIGIBLE.
    const eligible = a.status === "pending" || a.status === "confirmed";
    (itemsByDay[key] ??= []).push({
      id: a.id,
      time: timeFmt.format(start),
      name: a.customerName,
      serviceLine: staffName ? `${service} · ${staffName}` : service,
      status: a.status,
      visitorType: a.visitorType ?? null,
      canCheckIn: eligible && canCheckIn,
    });
  }

  // Labels are formatted for UTC-midnight dates in UTC, so they name the cell's own calendar day.
  // Assembled from parts as "Thursday, 24 September": the app's order, and what Home does for
  // "Thu, 24 Sep" (en-US alone would say "September 24").
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const labelFor = (d: Date) => {
    const parts = labelFmt.formatToParts(d);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("weekday")}, ${part("day")} ${part("month")}`;
  };

  const cells: CalendarCell[] = grid.map((d) => {
    const key = utcKey(d);
    const title = labelFor(d);
    const count = itemsByDay[key]?.length ?? 0;
    return {
      key,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
      isToday: key === todayKey,
      count,
      title,
      label: count
        ? plural(count, t.calendar.dayBookingsOne, t.calendar.dayBookings, { date: title })
        : title,
    };
  });

  // `d` (written by the client when a day is picked) may name a lead/trail day — the app lets
  // you open those too — so it is accepted anywhere on the visible grid, not only this month.
  const requested = params.d && /^\d{4}-\d{2}-\d{2}$/.test(params.d) && params.d >= from && params.d <= to
    ? params.d
    : null;
  const selectedKey = requested ?? (todayKey.startsWith(ym) ? todayKey : `${ym}-01`);
  // The 1st is only a stand-in so the docked panel (tablet/desktop) has a day to show. Nobody
  // picked it, and the app marks no day in a month without today until one is tapped, so the
  // phone grid leaves it unfilled (see `is-implicit` in calendar.css).
  const implicitSelection = requested === null && !todayKey.startsWith(ym);

  const prev = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month, 1)),
  );

  return (
    <div className="page-app calx-page">
      <AppPageHeader
        title={t.calendar.title}
        subtitle={plural(inMonthCount, t.calendar.bookingsOne, t.calendar.bookings)}
      />

      <LiveRefresh
        events={["appointment:created", "appointment:updated", "appointment:checked_in"]}
        pollOnly={me.user.role === "staff"}
      />

      <ScopeNotice me={me} context={t.calendar.scopeContext} />

      {/* Keyed by month: a new month starts from its own default day with the sheet shut, the
          same as the app, which re-runs its fetch and keeps nothing from the last month. */}
      <CalendarMonth
        key={ym}
        ym={ym}
        monthLabel={monthLabel}
        prevHref={`/calendar?ym=${ymKey(prev.getUTCFullYear(), prev.getUTCMonth())}`}
        nextHref={`/calendar?ym=${ymKey(next.getUTCFullYear(), next.getUTCMonth())}`}
        cells={cells}
        itemsByDay={itemsByDay}
        initialSelectedKey={selectedKey}
        initialImplicit={implicitSelection}
        initialOpen={requested !== null}
        afterCheckInHref={afterCheckInHref}
      />
    </div>
  );
}
