import { t, format } from "@/i18n";
import { currencySymbol } from "./currencies";
import type { Money, ServicePriceType } from "./server-api";

export { formatPhone } from "./phone";

/**
 * Money for display. The API returns minor units (paise/cents) with the store's ISO 4217 code —
 * see backend/src/domain/money.ts — so the amount is divided here, never on the server.
 *
 * The symbol comes from the static map shared with the app and the admin panel (so all three
 * print the same "$1,840"), and lakh grouping is for INR only: this used to format everything
 * in the en-IN locale, which printed a USD store's revenue as "$12,34,567".
 */
export function formatMoney(money: Money | null | undefined): string {
  if (!money) return "—";
  const major = money.amount / 100;
  const digits = major % 1 === 0 ? 0 : 2;
  const grouped = Math.abs(major).toLocaleString(money.currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${major < 0 ? "-" : ""}${currencySymbol(money.currency)}${grouped}`;
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

/**
 * "Paid by" for display ("Cash App", "UPI"). The API sends the code (`cash_app`); an unknown code
 * — a method added on the server before this client knew it — is shown as itself, never as blank.
 */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "card":
      return t.paymentMethod.card;
    case "cash":
      return t.paymentMethod.cash;
    case "venmo":
      return t.paymentMethod.venmo;
    case "zelle":
      return t.paymentMethod.zelle;
    case "cash_app":
      return t.paymentMethod.cashApp;
    case "upi":
      return t.paymentMethod.upi;
    case "other":
      return t.paymentMethod.other;
    default:
      return method ?? "";
  }
}
