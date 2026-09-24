import "@/styles/appointments.css";

import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { AppointmentListItem } from "@/components/AppointmentListItem";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import {
  appointmentTime,
  isCheckInEligible,
  longDayLabel,
  safeTimeZone,
} from "@/lib/appointments";
import { can, NO_ACCESS } from "@/lib/roles";
import {
  getAppointmentsFresh,
  getBusiness,
  getMe,
  getQueue,
  getServices,
  getStaff,
  type AppointmentRow,
} from "@/lib/server-api";

import { AppointmentsWalkIn } from "./AppointmentsWalkIn";

/**
 * Bookings whose time has come. Only these get the web's no-show shortcut (see
 * `AppointmentRowActions`). A helper rather than inline, so the page reads the clock once.
 */
function dueIds(list: AppointmentRow[]): Set<string> {
  const now = Date.now();
  return new Set(list.filter((a) => Date.parse(a.scheduledStartAt) <= now).map((a) => a.id));
}

/**
 * Today's bookings — the app's Appointments tab (app/src/app/(app)/(tabs)/appointments.tsx):
 * header with today's date and a "+" for a walk-in, "Upcoming today", then one row per booking
 * (`AppointmentListItem`) with "Add to queue", or the centred empty state.
 *
 * `GET /appointments` with no query already means today, on the store's clock. The app keeps only
 * `pending` / `confirmed` (its `loadAppointments` filter); the web lists those the same way under
 * "Upcoming today", and keeps the rest of the day — checked in, finished, cancelled, no-show — in
 * a second section below with the app's status badges, because the web has always shown them and
 * an owner at a desk uses them to see how the day went.
 */
export default async function AppointmentsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const canManage = can(access, "appointments", "manage");
  // The app shows "+" and "Add to queue" to everyone and lets the API refuse. Here each is hidden
  // without the permission its request needs: the "+" posts to /queue (queue:manage), check-in to
  // /appointments/:id/check-in (appointments:manage — without it the row shows its status).
  const canWalkIn = can(access, "queue", "manage");
  const staffScoped = me.user.role === "staff";

  // Uncached on purpose (see getAppointmentsFresh): GET /appointments is narrowed to a staff
  // login's own chair, but the cached reader keys on business + path only, so an owner and a staff
  // login shared one entry — a staff login could be shown the whole shop's bookings. The cache
  // also made LiveRefresh useless here: a microsite booking revalidates nothing on this app, so the
  // socket-driven refresh re-rendered the stale list for up to a minute.
  //
  // GET /staff accepts appointments:view, so every login that can open this page gets the names.
  // GET /business (the store's timezone) is profile-gated, as on Home: without it the clock falls
  // back to the default zone. The queue is read only for the walk-in sheet's seat loads, so its
  // "Any seat → soonest free" names the right chair instead of simply the first one.
  const [res, staff, services, business, queue] = await Promise.all([
    getAppointmentsFresh(),
    getStaff(),
    canWalkIn ? getServices() : Promise.resolve(null),
    can(access, "profile") ? getBusiness() : Promise.resolve(null),
    canWalkIn ? getQueue() : Promise.resolve(null),
  ]);

  const appointments = res?.data ?? [];
  const zone = safeTimeZone(business?.timezone);
  const staffNames = new Map((staff?.data ?? []).map((s) => [s.id, s.name] as const));

  // Staff walk-ins always land on their linked chair — don't offer every seat in the sheet (Home's rule).
  const walkInStaff = (staff?.data ?? []).filter(
    (s) => s.isActive && (!staffScoped || s.id === me.user.staffId),
  );
  const walkInServices = (services?.data ?? []).filter((s) => s.isActive);

  const upcoming = appointments.filter((a) => isCheckInEligible(a.status));
  const closed = appointments.filter((a) => !isCheckInEligible(a.status));
  const due = dueIds(upcoming);
  // After a check-in the app opens Home, where the new ticket is. A login that can't see the queue
  // would land on an empty Home, so it stays here instead.
  const afterCheckIn = can(access, "queue") ? "/dashboard" : null;

  const row = (a: AppointmentRow) => (
    <li key={a.id}>
      <AppointmentListItem
        appointment={a}
        time={appointmentTime(a.scheduledStartAt, zone)}
        staffName={a.staffId ? staffNames.get(a.staffId) : null}
        canManage={canManage}
        showNoShow={due.has(a.id)}
        afterCheckIn={afterCheckIn}
      />
    </li>
  );

  return (
    <div className="page-app appts-screen">
      {/* Settings is a tab of its own (bottom nav / sidebar), so the header carries only the app's
          "+" — as the app's Appointments header does. */}
      <AppPageHeader
        title={t.appointments.title}
        subtitle={longDayLabel(zone)}
        showSettings={false}
        action={
          canWalkIn ? (
            <AppointmentsWalkIn
              staff={walkInStaff}
              services={walkInServices}
              seats={queue?.seats ?? []}
              category={me.business.category}
            />
          ) : null
        }
      />

      <LiveRefresh
        events={["appointment:created", "appointment:updated", "appointment:checked_in"]}
        pollOnly={staffScoped}
      />

      <ScopeNotice me={me} context={t.appointments.scopeContext} />

      <h2 className="appts-section-title">{t.appointments.upcomingToday}</h2>

      {appointments.length === 0 ? (
        // Nothing booked at all: the app's `TEmptyState fill`, centred in the space left.
        <div className="appts-empty appts-empty-fill">
          <span className="appts-empty-disc" aria-hidden>
            <Icon name="calendar" size={24} />
          </span>
          <p className="appts-empty-title">{t.appointments.empty}</p>
          <p className="appts-empty-hint">{t.appointments.emptyHint}</p>
        </div>
      ) : upcoming.length === 0 ? (
        // Bookings today, but none still to come: saying "No appointments today" above a list of
        // today's appointments would be false, so the section gets the compact variant instead.
        <div className="appts-empty appts-empty-compact">
          <span className="appts-empty-disc" aria-hidden>
            <Icon name="calendar" size={20} />
          </span>
          <p className="appts-empty-title">{t.appointments.noneUpcoming}</p>
        </div>
      ) : (
        <ul className="appts-list">{upcoming.map(row)}</ul>
      )}

      {closed.length > 0 ? (
        <>
          <h2 className="appts-section-title">{t.appointments.closedToday}</h2>
          <ul className="appts-list">{closed.map(row)}</ul>
        </>
      ) : null}
    </div>
  );
}
