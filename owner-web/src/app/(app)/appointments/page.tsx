import { redirect } from "next/navigation";

import { AppointmentActions } from "@/components/AppointmentActions";
import { AppPageHeader } from "@/components/AppPageHeader";
import { ScopeNotice } from "@/components/ScopeNotice";
import { formatTime } from "@/lib/format";
import { getAppointments, getMe } from "@/lib/server-api";

/** Today's bookings. `GET /appointments` with no query already defaults to today. */
export default async function AppointmentsPage() {
  const [me, res] = await Promise.all([getMe(), getAppointments()]);
  if (!me) redirect("/login");
  const appointments = res?.data ?? [];

  return (
    <div className="page-app">
      <AppPageHeader title="Appointments" subtitle="Today" />

      <ScopeNotice me={me} context="your appointments" />

      {appointments.length === 0 ? (
        <div className="week-empty">
          <p className="nm">No appointments today</p>
          <p className="sub">
            Bookings for today show up here. Use Calendar for the rest of the week.
          </p>
        </div>
      ) : (
        <div className="appt-list">
          {appointments.map((a) => (
            <article key={a.id} className="appt-card">
              <div className="appt-time">{formatTime(a.scheduledStartAt)}</div>
              <div className="appt-body">
                <div className="nm">{a.customerName}</div>
                <div className="meta">{a.serviceName ?? "No service selected"}</div>
                <AppointmentActions id={a.id} status={a.status} />
              </div>
              <span className={`chip ${a.status}`}>{a.status.replace("_", " ")}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
