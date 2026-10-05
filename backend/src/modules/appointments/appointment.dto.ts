import { pgDate } from './booking.repo';

/**
 * The owner-facing appointment shape. Its own module so the series service can use it without
 * importing appointments.service (which imports the series service — a cycle).
 *
 * Hand-mirrored by owner-web (lib/server-api.ts `AppointmentRow`) and the app (lib/api.ts) with no
 * compiler between them: a field added here must be added there too.
 */
export function apptDTO(a: any) {
  return {
    id: a.id,
    customerName: a.customer_name,
    customerPhone: a.customer_phone,
    serviceId: a.service_id,
    serviceName: a.service_name,
    staffId: a.staff_id,
    scheduledStartAt: a.scheduled_start_at,
    scheduledEndAt: a.scheduled_end_at,
    status: a.status,
    source: a.source,
    queueEntryId: a.queue_entry_id,
    notes: a.notes,
    visitorType: a.visitor_type ?? null,
    // Recurring appointments (0036). Null on a one-off booking; the owner screens draw the repeat
    // icon from `seriesId`, and "Skipped" from `cancelReason`.
    seriesId: a.series_id ?? null,
    occurrenceDate: pgDate(a.occurrence_date),
    cancelReason: a.cancel_reason ?? null,
    // Moved by hand (0037) — the owner screens label it "Moved"; a later "change all future
    // visits" leaves it at this time.
    rescheduledAt: a.rescheduled_at ?? null,
  };
}
