import Link from "next/link";
import { t, format, plural } from "@/i18n";
import { redirect } from "next/navigation";

import { AppointmentActions } from "@/components/AppointmentActions";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";
import { ScopeNotice } from "@/components/ScopeNotice";
import { formatTime } from "@/lib/format";
import { getAppointments, getMe, type AppointmentRow } from "@/lib/server-api";

/** Local YYYY-MM-DD — not toISOString(), which shifts the date across UTC midnight. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYm(raw: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return { year: now.getFullYear(), month: now.getMonth() };
  return { year: y, month: m - 1 };
}

/** Sunday-start grid covering the month (6×7), same shape as the Expo calendar. */
const GRID_CELLS = 42;

function buildGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstOfMonth.getDay());
  return Array.from(
    { length: GRID_CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

function ymKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

const WEEKDAYS = t.calendar.days;

/**
 * Month calendar matching the Expo owner app: navigate months, tap a day, see that day's
 * bookings underneath. Data from `GET /appointments?from&to` over the visible 42-day grid
 * (under the backend's 45-day range cap).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; d?: string }>;
}) {
  const params = await searchParams;
  const { year, month } = parseYm(params.ym);
  const grid = buildGrid(year, month);
  const from = ymd(grid[0]);
  const to = ymd(grid[grid.length - 1]);

  const [me, res] = await Promise.all([
    getMe(),
    getAppointments(`?from=${from}&to=${to}`),
  ]);
  if (!me) redirect("/login");

  const appointments = res?.data ?? [];
  const byDay = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const key = a.scheduledStartAt.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(a);
    else byDay.set(key, [a]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
  }

  const todayKey = ymd(new Date());
  const monthPrefix = ymKey(year, month);
  const requestedDay =
    params.d && /^\d{4}-\d{2}-\d{2}$/.test(params.d) ? params.d : null;
  // Prefer an explicit day on this month; otherwise today if visible; else the 1st.
  let selectedKey: string;
  if (requestedDay && requestedDay.startsWith(monthPrefix)) {
    selectedKey = requestedDay;
  } else if (todayKey.startsWith(monthPrefix)) {
    selectedKey = todayKey;
  } else {
    selectedKey = `${monthPrefix}-01`;
  }

  const selectedItems = byDay.get(selectedKey) ?? [];
  const selectedLabel = new Date(
    Number(selectedKey.slice(0, 4)),
    Number(selectedKey.slice(5, 7)) - 1,
    Number(selectedKey.slice(8, 10)),
  ).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  const inMonthCount = appointments.filter((a) =>
    a.scheduledStartAt.startsWith(monthPrefix),
  ).length;

  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const prevYm = ymKey(prev.getFullYear(), prev.getMonth());
  const nextYm = ymKey(next.getFullYear(), next.getMonth());
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="page-app">
      <AppPageHeader
        title={t.calendar.title}
        subtitle={
          plural(inMonthCount, t.calendar.bookingsOne, t.calendar.bookings)
        }
      />

      <ScopeNotice me={me} context={t.calendar.scopeContext} />

      <div className="cal-layout">
        <div className="cal-panel section">
          <div className="cal-month-nav">
            <Link
              href={`/calendar?ym=${prevYm}`}
              className="btn secondary btn-sm btn-icon"
              aria-label={t.calendar.prevMonth}
            >
              <Icon name="chevronLeft" size={18} />
            </Link>
            <span className="cal-month-label">{monthLabel}</span>
            <Link
              href={`/calendar?ym=${nextYm}`}
              className="btn secondary btn-sm btn-icon"
              aria-label={t.calendar.nextMonth}
            >
              <Icon name="chevronRight" size={18} />
            </Link>
          </div>

          <div className="cal-app-grid" role="grid" aria-label={monthLabel}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-app-head" role="columnheader">
                {d}
              </div>
            ))}
            {grid.map((cell) => {
              const key = ymd(cell);
              const inMonth = cell.getMonth() === month;
              const cellYm = ymKey(cell.getFullYear(), cell.getMonth());
              const selected = key === selectedKey;
              const isToday = key === todayKey;
              const dayAppts = byDay.get(key);
              const hasAppts = Boolean(dayAppts?.length);
              return (
                <Link
                  key={key}
                  href={`/calendar?ym=${cellYm}&d=${key}`}
                  className={`cal-app-day${inMonth ? "" : " muted"}${selected ? " selected" : ""}${!selected && isToday ? " today" : ""}`}
                  aria-label={`${cell.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${hasAppts ? `, ${dayAppts!.length} booking${dayAppts!.length === 1 ? "" : "s"}` : ""}`}
                  aria-current={selected ? "date" : undefined}
                  role="gridcell"
                >
                  <span className="cal-app-day-num">{cell.getDate()}</span>
                  {hasAppts ? (
                    <span className="cal-dot" aria-hidden />
                  ) : (
                    <span className="cal-dot-slot" aria-hidden />
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="cal-agenda">
          <h2 className="home-section-title cal-day-heading">
            {selectedKey === todayKey ? format(t.calendar.todayLabel, { label: selectedLabel }) : selectedLabel}
          </h2>

          {selectedItems.length === 0 ? (
            <div className="week-empty">
              <p className="nm">{t.calendar.empty}</p>
              <p className="sub">
                {t.calendar.emptyHint}
              </p>
            </div>
          ) : (
            <div className="appt-list">
              {selectedItems.map((a) => (
                <article key={a.id} className="appt-card">
                  <div className="appt-time">{formatTime(a.scheduledStartAt)}</div>
                  <div className="appt-body">
                    <div className="nm">{a.customerName}</div>
                    <div className="meta">{a.serviceName ?? t.calendar.noService}</div>
                    <AppointmentActions id={a.id} status={a.status} />
                  </div>
                  <span className={`chip ${a.status}`}>{a.status.replace("_", " ")}</span>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
