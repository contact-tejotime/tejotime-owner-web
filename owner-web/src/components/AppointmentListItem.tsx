import "@/styles/appointments.css";

import { t } from "@/i18n";

import { AppointmentRowActions } from "@/components/AppointmentActions";
import { isCheckInEligible } from "@/lib/appointments";
import type { AppointmentRow } from "@/lib/server-api";

type Tone = "neutral" | "primary" | "info" | "success" | "error";

/**
 * The app's StatusBadge for a booking, keyed by the backend's status. Tones are the app's
 * (`components/ui/StatusBadge.tsx` STATUS_MAP via `mappers.ts toStatusKind`): pending is its
 * "upcoming".
 */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: t.appointments.status.pending, tone: "info" },
  confirmed: { label: t.appointments.status.confirmed, tone: "success" },
  checked_in: { label: t.appointments.status.checked_in, tone: "primary" },
  completed: { label: t.appointments.status.completed, tone: "success" },
  cancelled: { label: t.appointments.status.cancelled, tone: "neutral" },
  no_show: { label: t.appointments.status.no_show, tone: "error" },
};

export function AppointmentStatusBadge({ status }: { status: string }) {
  const meta = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <span className={`appt-status tone-${meta.tone}`}>
      <span className="appt-status-dot" aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * One booking, drawn as the app's `AppointmentListItem`: the time in a narrow column, then a card
 * with the store's colour down its left edge — name (with the Hospital MR / Patient badge),
 * "service · staff", and on the right either "Add to queue" or the booking's status.
 *
 * Not a client component: only the buttons need the browser, so they are the one island
 * (`AppointmentRowActions`). Reusable by any screen that lists bookings — the styles come with it.
 */
export function AppointmentListItem({
  appointment: a,
  time,
  staffName,
  canManage,
  showNoShow = false,
  afterCheckIn = null,
}: {
  appointment: AppointmentRow;
  /** Already formatted on the store's clock (`appointmentTime` in lib/appointments.ts). */
  time: string;
  staffName?: string | null;
  /**
   * `appointments: manage`. Without it the row shows the status instead of a button the API
   * would refuse — the app shows the button to everyone and lets the request fail.
   */
  canManage: boolean;
  showNoShow?: boolean;
  afterCheckIn?: string | null;
}) {
  const service = a.serviceName || t.appointments.noService;
  const serviceLine = staffName ? `${service} · ${staffName}` : service;
  const actionable = canManage && isCheckInEligible(a.status);

  return (
    <div className="appt-item">
      <div className="appt-item-time">{time}</div>
      <div className="appt-item-card">
        <div className="appt-item-body">
          <div className="appt-item-name-row">
            <p className="appt-item-name">{a.customerName}</p>
            {a.visitorType ? (
              <span className={`appt-badge tone-${a.visitorType === "mr" ? "info" : "secondary"}`}>
                {a.visitorType === "mr" ? t.appointments.mr : t.appointments.patient}
              </span>
            ) : null}
          </div>
          <p className="appt-item-service">{serviceLine}</p>
        </div>
        <div className="appt-item-side">
          {actionable ? (
            <AppointmentRowActions
              id={a.id}
              name={a.customerName}
              showNoShow={showNoShow}
              afterCheckIn={afterCheckIn}
            />
          ) : (
            <AppointmentStatusBadge status={a.status} />
          )}
        </div>
      </div>
    </div>
  );
}
