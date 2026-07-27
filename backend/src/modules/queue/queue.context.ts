import { many } from '../../db/pool';
import { ColorToken } from '../../config/constants';
import { EngineEntry, EngineService, EngineStaff } from '../../lib/queue-engine';
import { QueueSource, QueueStatus } from '../../domain/enums';

export interface RawEntry {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  service_name: string | null;
  service_id: string | null;
  staff_id: string | null;
  status: QueueStatus;
  source: QueueSource;
  position: number;
  extra_minutes: number;
  token: string | null;
  joined_at: string;
  started_at: string | null;
  appointment_id: string | null;
  notified_two_away_at: string | null;
  notified_turn_at: string | null;
  notified_eta_15_at: string | null;
}

export interface QueueContext {
  staffRows: any[];
  serviceRows: any[];
  entries: RawEntry[];
  engineStaff: EngineStaff[];
  engineServices: EngineService[];
  engineEntries: EngineEntry[];
}

/** Load everything the queue engine needs for a business (active entries only). */
export async function loadQueueContext(businessId: string): Promise<QueueContext> {
  const [staffRows, serviceRows, entryRows] = await Promise.all([
    many('select * from staff where business_id = $1 and is_active = true order by position', [businessId]),
    many('select * from service where business_id = $1 and is_active = true order by position', [businessId]),
    many(
      `select * from queue_entry
        where business_id = $1 and status in ('waiting', 'in_service')
        order by staff_id, position, joined_at`,
      [businessId],
    ),
  ]);

  const entries = entryRows as RawEntry[];

  const engineStaff: EngineStaff[] = staffRows.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color_token as ColorToken,
  }));
  const engineServices: EngineService[] = serviceRows.map((s) => ({
    name: s.name,
    durationMinutes: s.duration_minutes,
  }));
  const engineEntries: EngineEntry[] = entries.map((e) => ({
    id: e.id,
    name: e.customer_name,
    service: e.service_name ?? '',
    status: e.status,
    staffId: e.staff_id,
    source: e.source,
    extra: e.extra_minutes,
    startedAt: e.started_at,
  }));

  return { staffRows, serviceRows, entries, engineStaff, engineServices, engineEntries };
}
