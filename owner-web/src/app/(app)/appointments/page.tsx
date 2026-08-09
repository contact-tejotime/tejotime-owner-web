"use client";

import { AppPageHeader } from "@/components/AppPageHeader";
import { MOCK_APPOINTMENTS } from "@/lib/mock-data";

export default function AppointmentsPage() {
  return (
    <div className="page-app">
      <AppPageHeader
        title="Appointments"
        subtitle="Today"
        action={
          <button type="button" className="btn btn-sm">
            + New
          </button>
        }
      />

      <div className="appt-list">
        {MOCK_APPOINTMENTS.map((a) => (
          <article key={a.id} className="appt-card">
            <div className="appt-time">{a.time}</div>
            <div className="appt-body">
              <div className="nm">{a.customer}</div>
              <div className="meta">
                {a.service} · {a.staff}
              </div>
            </div>
            <span className={`chip ${a.status}`}>{a.status}</span>
          </article>
        ))}
      </div>
    </div>
  );
}
