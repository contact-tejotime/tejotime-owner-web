import { t, format } from "@/i18n";
import type { Money, ServicePriceType } from "./server-api";

export { formatPhone } from "./phone";

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

/**
 * A service's price as one string.
 *
 * Every surface used to render `formatMoney(price)` and, for the services nobody had priced
 * yet, print "₹0" — telling the owner their haircut was free. The mode now comes from the API,
 * so the three readings are decided once here rather than at each call site.
 */
export function formatServicePrice(service: {
  price: Money;
  priceType?: ServicePriceType;
  priceMax?: Money | null;
}): string {
  // A cached response from before pricing modes has no `priceType`; the old rule (a real
  // amount is a fixed price) still reads it correctly.
  const type = service.priceType ?? (service.price?.amount ? "fixed" : "unset");
  if (type === "unset") return t.services.unpriced;
  if (type === "range" && service.priceMax) {
    return format(t.services.rangeLabel, {
      min: formatMoney(service.price),
      max: formatMoney(service.priceMax),
    });
  }
  return formatMoney(service.price);
}
