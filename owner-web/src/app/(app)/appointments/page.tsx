import "@/styles/appointments.css";

import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { AppointmentListItem } from "@/components/AppointmentListItem";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import { BookingSheetsHost } from "@/components/series/BookingSheets";
import { NeedsAttentionCard } from "@/components/series/NeedsAttentionCard";
import {
  appointmentTime,
  isCheckInEligible,
  longDayLabel,
  safeTimeZone,
} from "@/lib/appointments";
import { can, NO_ACCESS } from "@/lib/roles";
import {
  closedWeekdays,
  isCancellable,
  isReschedulable,
  isSkippable,
  nextLabel,
  rhythmLabel,
  seriesStatusLabel,
  stylistLabel,
  type PickerContext,
} from "@/lib/series";
import {
  getAppointmentsFresh,
  getBusiness,
  getMe,
  getQueue,
  getSeriesIssues,
  getSeriesList,
  getServices,
  getStaff,
  type AppointmentRow,
  type SeriesIssue,
} from "@/lib/server-api";

import { AppointmentsWalkIn } from "./AppointmentsWalkIn";
import { RegularsList, type RegularRowView } from "./RegularsList";

type View = "today" | "regulars";

/**
 * Which rows get an extra button — the app's rule: before the booking's time, Skip for a series
 * visit and Cancel for a one-off; once its time has come, the no-show shortcut (see
 * `AppointmentRowActions`). The three are mutually exclusive, so a row keeps at most one extra
 * button and its shape. A helper rather than inline, so the page reads the clock once.
 */
function rowExtras(list: AppointmentRow[]): {
  due: Set<string>;
  skippable: Set<string>;
  cancellable: Set<string>;
  reschedulable: Set<string>;
} {
  const now = Date.now();
  return {
    due: new Set(list.filter((a) => Date.parse(a.scheduledStartAt) <= now).map((a) => a.id)),
    skippable: new Set(list.filter((a) => isSkippable(a, now)).map((a) => a.id)),
    cancellable: new Set(list.filter((a) => isCancellable(a, now)).map((a) => a.id)),
    // Reschedule sits beside Skip / Cancel on every row still ahead (Phase 2).
    reschedulable: new Set(list.filter((a) => isReschedulable(a, now)).map((a) => a.id)),
  };
}

/**
 * "Today" | "Regulars" — the app's segmented control. Links, not buttons: the view is a search
 * param (`?view=regulars`), so it is server-rendered, survives a reload and can be linked to.
 */
function ViewSwitch({ view }: { view: View }) {
  const items: { key: View; href: string; label: string }[] = [
    { key: "today", href: "/appointments", label: t.appointments.viewToday },
    { key: "regulars", href: "/appointments?view=regulars", label: t.appointments.viewRegulars },
  ];
  return (
    <nav className="appts-seg" aria-label={t.appointments.viewsLabel}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          className="appts-seg-btn"
          aria-current={view === item.key ? "page" : undefined}
        >
          {item.key === "regulars" ? <Icon name="repeat" size={14} /> : null}
          {item.label}
        </Link>
      ))}
    </nav>
  );
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
 *
 * Recurring appointments (docs/recurring-appointments.md) add a second view, **Regulars** — every
 * active or paused repeating booking — and, on Today, a **Needs attention** card for the series
 * dates the background job could not book. Both are read uncached: the API narrows them to a staff
 * login's own chair, exactly like the bookings (see getAppointmentsFresh).
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view === "regulars" ? "regulars" : "today";

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
  //
  // Each view reads only what it draws: Today the day's bookings and the Needs attention list,
  // Regulars the series list. The header's walk-in "+" is on both.
  const [res, staff, services, business, queue, issues, series] = await Promise.all([
    view === "today" ? getAppointmentsFresh() : Promise.resolve(null),
    getStaff(),
    canWalkIn ? getServices() : Promise.resolve(null),
    can(access, "profile") ? getBusiness() : Promise.resolve(null),
    canWalkIn ? getQueue() : Promise.resolve(null),
    view === "today" ? getSeriesIssues() : Promise.resolve(null),
    view === "regulars" ? getSeriesList() : Promise.resolve(null),
  ]);

  const zone = safeTimeZone(business?.timezone);
  const staffNames = new Map((staff?.data ?? []).map((s) => [s.id, s.name] as const));
  const activeStaff = (staff?.data ?? []).filter((s) => s.isActive);

  // Staff walk-ins always land on their linked chair — don't offer every seat in the sheet (Home's rule).
  const walkInStaff = activeStaff.filter((s) => !staffScoped || s.id === me.user.staffId);
  const walkInServices = (services?.data ?? []).filter((s) => s.isActive);

  // What the Reschedule / Change future visits pickers offer. A staff login moves bookings only on
  // its own chair (the API answers 403 otherwise), so it gets that chair and no "Any stylist".
  const picker: PickerContext = {
    zone,
    staff: walkInStaff.map((s) => ({ id: s.id, name: s.name, colorToken: s.colorToken })),
    allowAny: !staffScoped,
    closedDays: closedWeekdays(business?.hours),
  };

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

      {/* `series:updated` covers what the appointment events don't: a pause, a resume, a Needs
          attention item raised by the hourly job or handled on another device. */}
      <LiveRefresh
        events={["appointment:created", "appointment:updated", "appointment:checked_in", "series:updated"]}
        pollOnly={staffScoped}
      />

      <ScopeNotice me={me} context={t.appointments.scopeContext} />

      <ViewSwitch view={view} />

      {view === "regulars" ? (
        <RegularsList
          rows={(series?.data ?? []).map(
            (s): RegularRowView => ({
              id: s.id,
              name: s.customerName,
              rhythm: rhythmLabel(s),
              stylist: stylistLabel(s),
              next: nextLabel(s, zone),
              status: s.status,
              statusLabel: s.status === "active" ? null : seriesStatusLabel(s.status),
              needsAttention: s.openIssues > 0,
              version: `${s.updatedAt}|${s.openIssues}|${s.nextVisitAt ?? ""}|${s.status}`,
            }),
          )}
          picker={picker}
          canManage={canManage}
        />
      ) : (
        // The host owns the sheets a Server Component row cannot: a series visit's or a Needs
        // attention item's series sheet, row Reschedule, and Book another time.
        <BookingSheetsHost picker={picker} canManage={canManage}>
          <TodayView
            appointments={res?.data ?? []}
            issues={issues?.data ?? []}
            zone={zone}
            staffNames={staffNames}
            canManage={canManage}
            afterCheckIn={can(access, "queue") ? "/dashboard" : null}
          />
        </BookingSheetsHost>
      )}
    </div>
  );
}

function TodayView({
  appointments,
  issues,
  zone,
  staffNames,
  canManage,
  afterCheckIn,
}: {
  appointments: AppointmentRow[];
  issues: SeriesIssue[];
  zone: string;
  staffNames: Map<string, string>;
  canManage: boolean;
  /**
   * After a check-in the app opens Home, where the new ticket is. A login that can't see the queue
   * would land on an empty Home, so it stays here instead (null).
   */
  afterCheckIn: string | null;
}) {
  const upcoming = appointments.filter((a) => isCheckInEligible(a.status));
  const closed = appointments.filter((a) => !isCheckInEligible(a.status));
  const { due, skippable, cancellable, reschedulable } = rowExtras(upcoming);

  const row = (a: AppointmentRow) => (
    <li key={a.id}>
      <AppointmentListItem
        appointment={a}
        time={appointmentTime(a.scheduledStartAt, zone)}
        staffName={a.staffId ? staffNames.get(a.staffId) : null}
        canManage={canManage}
        showNoShow={due.has(a.id)}
        showSkip={skippable.has(a.id)}
        showCancel={cancellable.has(a.id)}
        showReschedule={reschedulable.has(a.id)}
        afterCheckIn={afterCheckIn}
      />
    </li>
  );

  return (
    <>
      {issues.length > 0 ? <NeedsAttentionCard issues={issues} zone={zone} canManage={canManage} /> : null}

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
    </>
  );
}
