import type { DailyValuePoint } from "@/components/charts/RevenueTrendChart";

/**
 * PLACEHOLDER DATA — every value in this file is static sample content for
 * wireframe features whose backend does not exist yet (billing, broadcasts,
 * reports, team/audit, activity feed, platform revenue series). When the real
 * endpoints land, swap the imports of this module for API calls and delete it.
 */

/** Static plan price. MRR shown in the UI = real premium-store count × this. */
export const PREMIUM_PLAN_PRICE_INR = 699;

/** Dashboard "Needs attention" items with no data source yet (payments, KYC). */
export const STATIC_ATTENTION_ITEMS: string[] = [];

export const STATIC_ACTIVITY_FEED: { text: string; time: string }[] = [
  { text: "Glow & Go added a service", time: "2h ago" },
  { text: "New store signup — Surat", time: "5h ago" },
  { text: "Payment retried · success", time: "Yesterday" },
  { text: "41 bookings last hour", time: "Yesterday" },
  { text: "Owner updated weekly hours", time: "2d ago" },
];

/** Deterministic 30-day series shaped like the wireframe sparkline (major units, INR). */
const REVENUE_PATTERN = [
  18, 21, 19, 24, 26, 23, 28, 31, 27, 33, 30, 36, 34, 38, 35, 41, 39, 44, 40, 46, 43, 48, 45, 51, 47, 53, 50, 56, 54,
  58,
];
export function staticRevenueTrend(): DailyValuePoint[] {
  const today = new Date();
  return REVENUE_PATTERN.map((v, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (REVENUE_PATTERN.length - 1 - i));
    return { date: d.toISOString().slice(0, 10), value: v * 100 };
  });
}

/** Billing table columns with no billing backend: same values for every premium store. */
export const STATIC_BILLING = {
  premiumNextInvoice: "1 Aug 2026",
  premiumStatus: "Paid" as const,
};

export const STATIC_BROADCAST_HISTORY: { title: string; meta: string }[] = [
  { title: "Price update notice", meta: "Jul 2 · 12 sent · 92% read" },
  { title: "Diwali campaign kit", meta: "Jun 20 · 10 sent · 80% read" },
];

export const STATIC_SMS_CREDITS = { used: 760, total: 2000 };

export const STATIC_REPORTS: { title: string; description: string; formats: string[] }[] = [
  { title: "Platform monthly digest", description: "MRR, signups, churn", formats: ["Email on the 1st"] },
  { title: "Store performance", description: "Visits, revenue per store", formats: ["CSV", "PDF"] },
  { title: "Revenue by city", description: "30 / 90 day comparison", formats: ["CSV"] },
  { title: "No-show report", description: "By store & service", formats: ["CSV"] },
];

export const STATIC_RECENT_EXPORTS: { file: string; date: string }[] = [
  { file: "stores-jun-2026.csv", date: "Jul 1" },
  { file: "digest-may-2026.pdf", date: "Jun 1" },
];

export const STATIC_TEAM: { name: string; role: string; lastActive: string }[] = [
  { name: "Ravi (you)", role: "Owner", lastActive: "now" },
  { name: "Sneha", role: "Support", lastActive: "2h ago" },
  { name: "Karan", role: "Analyst", lastActive: "1d ago" },
];

export const STATIC_AUDIT_LOG: { time: string; text: string }[] = [
  { time: "10:41", text: "Sneha edited Glow & Go services" },
  { time: "09:12", text: "Ravi deactivated Style Studio" },
  { time: "Yesterday", text: "Karan exported stores.csv" },
];
