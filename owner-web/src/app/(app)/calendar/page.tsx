import { redirect } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { ScopeNotice } from "@/components/ScopeNotice";
import { formatTime } from "@/lib/format";
import { getAppointments, getMe } from "@/lib/server-api";

/** Local YYYY-MM-DD — not toISOString(), which shifts the date across UTC midnight. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Seven-day agenda from `GET /appointments?from&to` — the same range call the mobile app's
 * calendar makes. The backend caps a range at 45 days; a week is well inside that.
 */
export default async function CalendarPage() {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 6);

  const [me, res] = await Promise.all([
    getMe(),
    getAppointments(`?from=${ymd(start)}&to=${ymd(end)}`),
  ]);
  if (!me) redirect("/login");
  const appointments = res?.data ?? [];

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymd(d);
    return {
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      isToday: i === 0,
      items: appointments
        .filter((a) => a.scheduledStartAt.slice(0, 10) === key)
        .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt)),
    };
  });

  const total = appointments.length;

  return (
    <div className="page-app">
      <AppPageHeader
        title="Calendar"
        subtitle={total === 1 ? "1 booking this week" : `${total} bookings this week`}
      />

      <ScopeNotice me={me} context="your calendar" />

      {/* A whole week of empty days used to render as seven identical "Nothing booked" lines,
          which reads as a broken page rather than a quiet week. One clear statement instead. */}
      {total === 0 ? (
        <div className="week-empty">
          <p className="nm">Nothing booked in the next 7 days</p>
          <p className="sub">
            Bookings made online or added here will appear on the day they are scheduled.
          </p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day.key} style={{ marginTop: 18 }}>
            <h2 className="home-section-title">
              {day.isToday ? `Today · ${day.label}` : day.label}
            </h2>
            {day.items.length === 0 ? (
              <p className="home-empty">Nothing booked</p>
            ) : (
              <div className="appt-list">
                {day.items.map((a) => (
                  <article key={a.id} className="appt-card">
                    <div className="appt-time">{formatTime(a.scheduledStartAt)}</div>
                    <div className="appt-body">
                      <div className="nm">{a.customerName}</div>
                      <div className="meta">{a.serviceName ?? "No service selected"}</div>
                    </div>
                    <span className={`chip ${a.status}`}>{a.status.replace("_", " ")}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
