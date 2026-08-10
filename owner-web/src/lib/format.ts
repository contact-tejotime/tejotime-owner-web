import type { Money } from "./server-api";

/**
 * Display a stored phone (E.164 or digits-only, e.g. `919824410712`) as `+91 9824410712`.
 * No libphonenumber dependency — India-first heuristic with a safe fallback.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return String(raw).trim();
  if (digits.length >= 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2)}`;
  }
  if (digits.length === 10) return `+91 ${digits}`;
  return `+${digits}`;
}

/**
 * Money for display. The API returns minor units (paise) with an ISO 4217 code — see
 * backend/src/domain/money.ts — so the amount is divided here, never on the server.
 */
export function formatMoney(money: Money | null | undefined): string {
  if (!money) return "—";
  const major = money.amount / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: money.currency || "INR",
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    // Unknown currency code — show the number rather than throwing.
    return `${money.currency} ${major.toFixed(0)}`;
  }
}

/** "9:05 AM" in the viewer's locale. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Mon, 9 Aug". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
