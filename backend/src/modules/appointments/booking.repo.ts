import { env } from '../../config/env';
import { BOOKING_WINDOW_DAYS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import type { SlotInput } from '../../lib/booking-slots';
import { projectedBookings, ruleFromColumns } from '../../lib/recurrence';
import { dayjs } from '../../lib/time';

/**
 * The DB side of "can this time be booked?", shared by public booking (public.service.ts) and
 * recurring series (series.service.ts) so the two can never judge a time differently.
 *
 * Everything reads through `q`, so the same loader serves a plain pool read (the slot list) and a
 * locked transaction client (booking, and the series job under the same `appt:` lock).
 */

export type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

/** A service as a visit uses it: current name, length and price. */
export interface VisitService {
  id: string;
  name: string;
  duration_minutes: number;
  price_paise: number;
}

/**
 * Everything computeSlots needs for one store-day. Bookings are every live row that OVERLAPS the
 * day — end times included, because capacity is decided by overlap, not by an exact start. A row
 * with no end (older owner bookings) counts as one slot.
 *
 * "Live" includes `checked_in`: the customer is in the chair, so the rest of their booked time is
 * still theirs. Until 2026-10-28 only pending/confirmed counted, so the moment a 12:00–13:00 visit
 * was checked in, 12:30 showed as free on that stylist and the owner or a customer could book on top
 * of it (smoke-no-overlap-db.ts). A check-in never changes to `completed`, so this holds the booked
 * window only — never longer. Cancelled and no-show rows free their time.
 *
 * `windowDays` defaults to the public window; the series job passes its own (today+20) — see
 * lib/recurrence.ts. `now` is injectable so the job can be driven through time in tests.
 *
 * Edits (moving a visit, changing a series, booking a Needs-attention date) also pass:
 *  - `excludeIds` — the visits being moved or replaced, so they do not block their own new time;
 *  - `project` — regulars' NOT-YET-BOOKED series dates count as taken. Public booking never needs
 *    this (its window ends before the job's horizon); an owner moving a visit 60 days out does.
 */
export async function slotInputFor(
  q: Query,
  b: any,
  date: string,
  durationMin: number,
  staffId: string | null,
  opts: { now?: Date; windowDays?: number; excludeIds?: string[]; project?: { exceptSeriesId?: string } } = {},
): Promise<SlotInput> {
  const tz = b.timezone;
  const day = dayjs.tz(date, tz);
  const [hours] = await q('select opens_at, closes_at, is_closed from business_hour where business_id = $1 and day_of_week = $2', [
    b.id,
    day.day(),
  ]);
  const staff = await q('select id from staff where business_id = $1 and is_active = true', [b.id]);
  const bookings = await q(
    `select scheduled_start_at,
            coalesce(scheduled_end_at, scheduled_start_at + make_interval(mins => $4)) as scheduled_end_at,
            staff_id
       from appointment
      where business_id = $1
        and status in ('pending', 'confirmed', 'checked_in')
        and scheduled_start_at < $3
        and coalesce(scheduled_end_at, scheduled_start_at + make_interval(mins => $4)) > $2
        and not (id = any($5::uuid[]))`,
    [
      b.id,
      day.startOf('day').utc().toISOString(),
      day.endOf('day').utc().toISOString(),
      env.BOOKING_SLOT_MINUTES,
      opts.excludeIds ?? [],
    ],
  );
  const slotBookings = bookings.map((r) => ({ start: r.scheduled_start_at, end: r.scheduled_end_at, staffId: r.staff_id }));
  if (opts.project) slotBookings.push(...(await seriesProjectionFor(q, b, date, opts.project.exceptSeriesId)));
  return {
    date,
    tz,
    hours: hours ? { opensAt: hours.opens_at, closesAt: hours.closes_at, isClosed: hours.is_closed } : null,
    durationMin,
    stepMin: env.BOOKING_SLOT_MINUTES,
    now: opts.now ?? new Date(),
    windowDays: opts.windowDays ?? BOOKING_WINDOW_DAYS,
    bookings: slotBookings,
    activeStaffIds: staff.map((s) => s.id),
    staffId,
  };
}

/** Active series whose cursor is before `date`, as pseudo-bookings on that day (see projectedBookings). */
async function seriesProjectionFor(q: Query, b: any, date: string, exceptSeriesId?: string) {
  const rows = await q(
    `select s.id, s.status, s.staff_id, s.staff_locked, left(s.start_time::text, 5) as start_time,
            s.anchor_date::text as anchor_date, s.anchor_index, s.interval_days, s.end_type, s.end_count,
            s.end_date::text as end_date, s.generated_through::text as generated_through,
            coalesce(st.is_active, false) as staff_active,
            coalesce((select sum(sv.duration_minutes) from appointment_series_service ss
                        join service sv on sv.id = ss.service_id
                       where ss.series_id = s.id), 0)::int as minutes
       from appointment_series s
       left join staff st on st.id = s.staff_id
      where s.business_id = $1 and s.status = 'active' and s.generated_through < $2::date
        and ($3::uuid is null or s.id <> $3::uuid)`,
    [b.id, date, exceptSeriesId ?? null],
  );
  return projectedBookings(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      rule: ruleFromColumns(r),
      startTime: r.start_time,
      generatedThrough: r.generated_through,
      staffId: r.staff_id,
      staffLocked: r.staff_locked,
      staffActive: r.staff_active,
      minutes: r.minutes > 0 ? r.minutes : env.BOOKING_SLOT_MINUTES,
    })),
    date,
    b.timezone,
  ).map((p) => ({ start: p.start, end: p.end, staffId: p.staffId }));
}

/**
 * The services a visit is for, in the order they were picked, validated against this business.
 *
 * One resolver for every entry point — the public slots, join and book (public.service.ts) and the
 * owner's booking (owner-booking.service.ts) — so they can never disagree about what was selected:
 * the slot length, the queue entry's duration and the checkout total all derive from this list.
 *
 * `serviceId` (singular) is still accepted: it is what every already-shipped client sends. When
 * both arrive `serviceIds` wins, with the singular folded in first if it is not already present.
 *
 * `activeOnly` refuses a service the store has switched off. The owner path sets it; the public
 * path does not (yet), so its query stays exactly as it was.
 */
export async function resolveServices(
  q: Query,
  businessId: string,
  input: { serviceId?: string | null; serviceIds?: string[] },
  opts: { activeOnly?: boolean } = {},
): Promise<VisitService[]> {
  const ids: string[] = [];
  for (const id of [...(input.serviceIds ?? []), ...(input.serviceId ? [input.serviceId] : [])]) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return [];

  const rows: VisitService[] = await q(
    'select id, name, duration_minutes, price_paise from service where business_id = $1 and id = any($2::uuid[])' +
      (opts.activeOnly ? ' and is_active = true' : ''),
    [businessId, ids],
  );
  // Any unknown id is a hard error rather than a silent drop: quietly booking a shorter, cheaper
  // visit than the one the customer chose is the failure this whole feature exists to prevent.
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw Errors.notFound('Service not found');
  // Preserve the picked order — the first pick becomes the primary service.
  return ids.map((id) => rows.find((r) => r.id === id)!);
}

/** A multi-service visit occupies the SUM of its parts; no service → the standard slot. */
export function visitMinutes(svcs: Array<{ duration_minutes: number | null }>): number {
  const total = svcs.reduce((n, sv) => n + (sv.duration_minutes || 0), 0);
  return total > 0 ? total : env.BOOKING_SLOT_MINUTES;
}

/** "Haircut + Hair Spa" — the label the queue board, the ticket and the visit ledger all show. */
export const combinedServiceName = (svcs: { name: string }[]) => (svcs.length ? svcs.map((s) => s.name).join(' + ') : null);

/**
 * Itemise a booking. A booking is made now and checked in later, so without this list
 * `appointment_check_in` could not rebuild the queue entry's extras and the visit would be sized
 * and priced as if only the first service had been chosen (migration 0025).
 */
export async function insertAppointmentServices(q: Query, appointmentId: string, svcs: VisitService[]): Promise<void> {
  if (!svcs.length) return;
  // `position` is load-bearing, not decoration: check-in reads `position > 0` to find the
  // services to re-attach, so leaving it at its default of 0 would hide every extra.
  const values = svcs
    .map((_, i) => `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`)
    .join(', ');
  await q(
    `insert into appointment_service (appointment_id, service_id, name, minutes, price_paise, position)
     values ${values}`,
    [appointmentId, ...svcs.flatMap((sv, i) => [sv.id, sv.name, sv.duration_minutes, sv.price_paise, i])],
  );
}

/**
 * A Postgres `date` as 'YYYY-MM-DD'. node-pg has no date type parser configured here, so a `date`
 * read through `select *` arrives as a JS Date at the SERVER's local midnight — and `toISOString()`
 * on that lands on the previous day anywhere east of UTC. Queries that can, cast `::text`; this
 * covers the rows that come back from `returning *`.
 */
export function pgDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return null;
}
