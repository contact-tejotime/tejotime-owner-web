/** Sample data for the TejoTime owner app — ported from the design's data.js. */
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
};

export type QueueEntry = {
  id: number;
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
  id: number;
  name: string;
  service: string;
  time: string;
  status: StatusKind;
};

export type Customer = {
  id: number;
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

export const business = { name: 'Sharp Cuts', area: 'Andheri West', category: 'Salon & Barber' };

export const staff: Staff[] = [
  { id: 'john', name: 'John', color: 'primary' },
  { id: 'lisa', name: 'Lisa', color: 'secondary' },
  { id: 'mike', name: 'Mike', color: 'amber500' },
];

export const kpis: Kpi[] = [
  { key: 'appointments', label: "Today's appts", value: '24', delta: '+4', icon: 'calendar', tone: 'primary' },
  { key: 'waiting', label: 'Waiting now', value: '8', delta: '+2', icon: 'users', tone: 'warning' },
  { key: 'completed', label: 'Completed', value: '11', delta: '+11', icon: 'checkCircle', tone: 'success' },
  { key: 'revenue', label: "Today's revenue", value: '₹18.4k', delta: '+12%', icon: 'dollar', tone: 'secondary' },
];

export const queue: QueueEntry[] = [
  { id: 1, name: 'Aisha Khan', service: 'Haircut & Beard', time: '10:30 AM', status: 'in-service', wait: 0, staffId: 'john', src: 'walk-in' },
  { id: 2, name: 'Rahul Mehta', service: 'Hair Color', time: '10:45 AM', status: 'waiting', wait: 15, staffId: 'john', src: 'online' },
  { id: 3, name: 'Sana Iqbal', service: 'Haircut', time: '11:00 AM', status: 'waiting', wait: 30, staffId: 'john', src: 'online' },
  { id: 4, name: 'Vivek Rao', service: 'Haircut', time: '10:50 AM', status: 'in-service', wait: 0, staffId: 'lisa', src: 'online' },
  { id: 5, name: 'Imran Shah', service: 'Beard Trim', time: '11:25 AM', status: 'waiting', wait: 20, staffId: 'lisa', src: 'walk-in' },
];

export const appointments: AppointmentEntry[] = [
  { id: 11, name: 'Neha Gupta', service: 'Keratin Treatment', time: '12:30 PM', status: 'confirmed' },
  { id: 12, name: 'Arjun Das', service: 'Haircut', time: '1:00 PM', status: 'confirmed' },
  { id: 13, name: 'Priya Nair', service: 'Hair Spa', time: '2:15 PM', status: 'upcoming' },
  { id: 14, name: 'Karan Bose', service: 'Haircut & Beard', time: '3:00 PM', status: 'upcoming' },
];

export const customers: Customer[] = [
  { id: 21, name: 'Rahul Mehta', phone: '+91 98201 12345', visits: 14, last: '3d', spend: '₹6.2k', vip: true },
  { id: 22, name: 'Aisha Khan', phone: '+91 99301 55512', visits: 9, last: 'Today', spend: '₹4.1k', vip: false },
  { id: 23, name: 'Neha Gupta', phone: '+91 90040 87654', visits: 22, last: '1w', spend: '₹12.8k', vip: true },
  { id: 24, name: 'Vivek Rao', phone: '+91 91234 00099', visits: 3, last: '2w', spend: '₹1.4k', vip: false },
];

export const services: Service[] = [
  { name: 'Haircut', duration: '30 min', price: '₹350', color: 'secondary' },
  { name: 'Haircut & Beard', duration: '45 min', price: '₹450', color: 'primary' },
  { name: 'Hair Color', duration: '90 min', price: '₹1,200', color: 'amber500' },
  { name: 'Hair Spa', duration: '60 min', price: '₹800', color: 'green500' },
];
