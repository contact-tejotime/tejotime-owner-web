/**
 * PLACEHOLDER DATA — static sample content for wireframe features whose
 * backend does not exist yet (broadcasts, team/audit). When the real
 * endpoints land, swap the imports of this module for API calls and delete it.
 */

/**
 * Premium plan price (business config, not sample data). MRR shown in the UI =
 * real premium-store count × this. Move to the backend when billing goes live.
 */
export const PREMIUM_PLAN_PRICE_INR = 699;

// ---- Used only by the parked pages in (protected)/_broadcasts and _team ----

export const STATIC_BROADCAST_HISTORY: { title: string; meta: string }[] = [
  { title: "Price update notice", meta: "Jul 2 · 12 sent · 92% read" },
  { title: "Diwali campaign kit", meta: "Jun 20 · 10 sent · 80% read" },
];

export const STATIC_SMS_CREDITS = { used: 760, total: 2000 };

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
