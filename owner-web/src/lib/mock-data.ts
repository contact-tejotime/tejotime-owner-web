export type SeatItem = {
  id: string;
  name: string;
  status: "free" | "busy";
  subtitle: string;
  color: string;
};

export type ServiceItem = {
  id: string;
  name: string;
  mins: number;
  price: string;
  accent: string;
};

export type QueueItem = {
  id: string;
  customer: string;
  service: string;
  staff: string;
  status: "waiting" | "in_service";
  waitMins: number;
};

export type AppointmentItem = {
  id: string;
  time: string;
  customer: string;
  service: string;
  staff: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
};

export type CustomerItem = {
  id: string;
  name: string;
  phone: string;
  visits: number;
  lastVisit: string;
  spend: string;
};

export const MOCK_BUSINESS = {
  id: "biz_1",
  name: "Sharp Cut",
  slug: "sharp-cut",
  area: "Andheri West",
  openTill: "Open till 9 PM",
};

export const MOCK_USER = {
  id: "user_1",
  name: "Priya Sharma",
  phone: "919876543210",
};

export const MOCK_SEATS: SeatItem[] = [
  { id: "s1", name: "Aman", status: "free", subtitle: "Available · ready for walk-in", color: "#7C3AED" },
  { id: "s2", name: "Arjun", status: "free", subtitle: "Available · ready for walk-in", color: "#F97316" },
  { id: "s3", name: "Herish", status: "free", subtitle: "Available · ready for walk-in", color: "#F59E0B" },
  { id: "s4", name: "Jay", status: "free", subtitle: "Available · ready for walk-in", color: "#16A34A" },
];

export const MOCK_SERVICES: ServiceItem[] = [
  { id: "sv1", name: "Hair cut", mins: 30, price: "₹500", accent: "#7C3AED" },
  { id: "sv2", name: "Smoothing hair treatment", mins: 30, price: "₹700", accent: "#A78BFA" },
  { id: "sv3", name: "Hair Colour", mins: 90, price: "₹2,600", accent: "#F59E0B" },
];

export const MOCK_QUEUE: QueueItem[] = [];

export const MOCK_APPOINTMENTS: AppointmentItem[] = [
  { id: "a1", time: "10:00 AM", customer: "Suresh Nair", service: "Haircut", staff: "Aman", status: "confirmed" },
  { id: "a2", time: "11:30 AM", customer: "Ananya Rao", service: "Highlights", staff: "Arjun", status: "pending" },
  { id: "a3", time: "01:00 PM", customer: "Vikram Joshi", service: "Haircut + Beard", staff: "Aman", status: "confirmed" },
];

export const MOCK_CUSTOMERS: CustomerItem[] = [
  { id: "c1", name: "dwe", phone: "+91 123123123123", visits: 0, lastVisit: "—", spend: "₹0" },
  { id: "c2", name: "Your name", phone: "+91 123123123123", visits: 0, lastVisit: "—", spend: "₹0" },
];

export const MOCK_STATS = {
  waiting: 0,
  inService: 0,
  appointmentsToday: 0,
  checkIn: 0,
  revenue: "₹0",
  lockedClients: 8,
};
