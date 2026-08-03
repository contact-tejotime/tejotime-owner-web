/** Domain types for the TejoTime owner app. Data now comes from the API
 *  (see src/lib/api.ts + src/state/store.tsx); only the type shapes and the
 *  static business identity remain here. */
import { IconName } from '@/components/ui/Icon';
import { StatusKind } from '@/components/ui/StatusBadge';

export type Kpi = {
  key: string;
  label: string;
  value: string;
  delta: string;
  icon: IconName;
  tone: 'primary' | 'warning' | 'success' | 'secondary';
};

/** Color token keys resolved against the theme (shared by services & seats). */
export type ServiceColorToken = 'secondary' | 'primary' | 'amber500' | 'green500';

export type QueueSource = 'walk-in' | 'online';

export type Staff = {
  id: string;
  name: string;
  color: ServiceColorToken;
  roleLabel?: string;
  photoUrl?: string | null;
};

export type QueueEntry = {
  id: string;
  name: string;
  service: string;
  time: string;
  status: StatusKind;
  wait: number;
  staffId: string;
  src: QueueSource;
  /** Extra minutes added to the running service. */
  extra?: number;
};

export type AppointmentEntry = {
  id: string;
  name: string;
  service: string;
  time: string;
  status: StatusKind;
  staffId?: string | null;
  visitorType?: 'mr' | 'patient' | null;
};

/** Appointment view-model for the calendar screen — keeps the raw start
 *  timestamp plus a local `YYYY-MM-DD` key so appointments can be grouped
 *  by calendar day. */
export type CalendarAppointmentEntry = AppointmentEntry & {
  dateKey: string;
  startAt: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  visits: number;
  last: string;
  spend: string;
  vip: boolean;
};

export type Service = {
  name: string;
  duration: string;
  price: string;
  color: ServiceColorToken;
};

/** Service with its server id + raw editable fields — the shape the store holds. */
export type ServiceVM = Service & {
  id: string;
  durationMinutes: number;
  /** Price in whole rupees (API speaks paise — convert only at the call site). */
  priceRupees: number;
  colorToken: ServiceColorToken;
};

export const business = { name: 'Sharp Cuts', area: 'Andheri West', category: 'Salon & Barber' };
