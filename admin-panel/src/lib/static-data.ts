import { t } from "@/i18n";
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

// ---- Used only by the parked page in (protected)/_broadcasts ----
// Team is no longer here: it runs on real /admin/admins data as of the multi-admin work, and
// the audit log is deliberately absent rather than faked.

export const STATIC_BROADCAST_HISTORY: { title: string; meta: string }[] =
  t.broadcasts.historyItems;

export const STATIC_SMS_CREDITS = { used: 760, total: 2000 };
