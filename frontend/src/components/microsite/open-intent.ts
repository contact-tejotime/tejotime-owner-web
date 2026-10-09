/**
 * Which pop-up the store page should open on arrival, read from its link
 * (docs/customer-booking-page-copy-2026-09-06.md, "Open a pop-up from a link").
 *
 * A store advertising on Instagram links its "Book now" button to `/<phone>?instagram`; the
 * customer lands inside Instagram's own browser, and making them hunt for Check in costs the
 * visit. `?open=checkin` / `?open=book` is the general form for every other channel (WhatsApp,
 * a QR poster, the Google profile); a bare `?instagram` is kept because the client's ads already
 * carry it, and means Check in.
 *
 * Every other key is ignored on purpose: Instagram and Meta append their own (`igsh`, `fbclid`,
 * `utm_*`), so "any query string" must never be read as a request.
 *
 * Keep this file free of imports: `npm run test:open-intent` runs it with plain tsx from backend/.
 */
export type OpenIntent = "checkin" | "book";

/** The keys this module owns, and the only ones stripOpenIntent removes. */
const KEYS = ["open", "instagram"] as const;

export function readOpenIntent(search: string): OpenIntent | null {
  const q = new URLSearchParams(search);
  // The owner's Appearance editor frames the page with ?preview=1. A pop-up there would cover
  // the very page they are styling.
  if (q.get("preview") === "1") return null;
  const open = (q.get("open") ?? "").trim().toLowerCase();
  if (open === "checkin" || open === "check-in") return "checkin";
  if (open === "book") return "book";
  if (q.has("instagram")) return "checkin";
  return null;
}

/**
 * The same query string without the keys above — "" when nothing else is left, otherwise with
 * its leading "?". The page drops them once read, so a refresh, or the link forwarded from the
 * address bar, opens the plain page rather than the pop-up again.
 */
export function stripOpenIntent(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of KEYS) q.delete(k);
  const rest = q.toString();
  return rest ? `?${rest}` : "";
}
