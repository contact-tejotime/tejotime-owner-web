import { supabase } from '../../db/supabase';
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
  notified_two_away_at: string | null;
  notified_turn_at: string | null;
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
  const [staffRes, serviceRes, entryRes] = await Promise.all([
    supabase
      .from('staff')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position', { ascending: true }),
    supabase
      .from('service')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position', { ascending: true }),
    supabase
      .from('queue_entry')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['waiting', 'in_service'])
      .order('staff_id', { ascending: true })
      .order('position', { ascending: true })
      .order('joined_at', { ascending: true }),
  ]);

  const staffRows = staffRes.data ?? [];
  const serviceRows = serviceRes.data ?? [];
  const entries = (entryRes.data ?? []) as RawEntry[];

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
  }));

  return { staffRows, serviceRows, entries, engineStaff, engineServices, engineEntries };
}
