/**
 * Cookie-consent state: the record, the cookie, and the few pure helpers around them.
 *
 * Framework-free on purpose — no React, no next/* — so the rules below are readable in one
 * place and testable as plain TypeScript.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: nothing is written to any storage until the visitor has
 * actively chosen. There is no pre-consent identifier, no "pending" cookie, no localStorage
 * probe, and `visitorId` is minted at the moment of the click and never before. Under GDPR the
 * identifier IS the personal data, so creating one in order to record that someone has not yet
 * consented would be the exact thing consent is supposed to gate.
 */

/** The four buckets the UI exposes. `necessary` is always true and is not a choice. */
export interface ConsentCategories {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}

/** What actually lives inside the `cookie_consent` cookie, as JSON. */
export interface ConsentRecord extends ConsentCategories {
  /** Minted with crypto.randomUUID() at the moment of choice. Never exists before that. */
  visitorId: string;
  /** ISO 8601, when the choice was made. */
  timestamp: string;
  /** The CONSENT_VERSION in force when they chose — drives re-prompting. */
  version: string;
}

export const COOKIE_NAME = "cookie_consent";

/**
 * Bump this when the categories, their meaning, or who receives the data changes — NOT for copy
 * tweaks. A bump re-prompts everyone, so it is a real cost to the visitor; spend it only when
 * the previous consent no longer covers what we now do.
 */
export const CONSENT_VERSION = "2026-09-11";

/**
 * Six months. The EDPB's guidance is that consent should not outlive the visitor's reasonable
 * expectation, and 6 months is the common reading of that for a marketing site; a year is
 * defensible but harder to argue. Named here so the number is never re-typed at a call site.
 */
export const CONSENT_MAX_AGE_DAYS = 182;
export const CONSENT_MAX_AGE_SECONDS = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;

/**
 * Stacking for the two consent surfaces, in one place so they cannot drift apart.
 *
 * Both sit above everything else the site renders. For reference, the highest existing values
 * are the microsite's join modal (200) and its chat panel (190), and the marketing header (40),
 * so 1000/1010 clears them all with room to spare. The modal is the only thing allowed above
 * the banner.
 */
export const Z_INDEX = {
  banner: 1000,
  modal: 1010,
} as const;

/** Everything off except what the site cannot run without. The starting point for a new visitor. */
export const DEFAULT_CATEGORIES: ConsentCategories = {
  necessary: true,
  analytics: false,
  marketing: false,
  preferences: false,
};

/** Analytics cookie names to sweep when consent is withdrawn (see `clearAnalyticsCookies`). */
const ANALYTICS_COOKIE_PREFIXES = ["_ga", "_gid", "_gat"];

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

/**
 * Read and validate the stored record.
 *
 * Returns null for absent, malformed, or structurally wrong cookies rather than throwing — a
 * visitor with a corrupted cookie should simply be asked again, never see a broken page. Note
 * this validates SHAPE only; a stale `version` still parses, because the caller needs the old
 * answers to pre-load the toggles on a re-prompt.
 */
export function readConsent(): ConsentRecord | null {
  if (!isBrowser()) return null;
  try {
    const raw = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    if (!raw) return null;

    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentRecord>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.visitorId !== "string" ||
      typeof parsed.timestamp !== "string" ||
      typeof parsed.version !== "string" ||
      typeof parsed.analytics !== "boolean" ||
      typeof parsed.marketing !== "boolean" ||
      typeof parsed.preferences !== "boolean"
    ) {
      return null;
    }
    return {
      visitorId: parsed.visitorId,
      necessary: true,
      analytics: parsed.analytics,
      marketing: parsed.marketing,
      preferences: parsed.preferences,
      timestamp: parsed.timestamp,
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

/** crypto.randomUUID needs a secure context; the fallback keeps plain-http dev working. */
function newVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Persist a choice and return the record that was written.
 *
 * Cookie attributes, and why each one:
 *
 *   Path=/              every page on this origin reads the same answer.
 *   Max-Age=6 months    see CONSENT_MAX_AGE_DAYS.
 *   SameSite=Lax        the cookie is only ever read by this site's own pages; Lax still
 *                       survives a normal top-level navigation in from an ad or an email.
 *   Secure              only on https. Setting it on plain http would make the browser DROP
 *                       the cookie, which on a local build reads as "consent silently fails" —
 *                       so it keys off the actual protocol rather than a build flag.
 *   (no Domain)         DELIBERATELY ABSENT. Omitting Domain makes the cookie HOST-ONLY: it is
 *                       sent only to the exact host that set it. Setting Domain=.tejotime.com
 *                       would attach this cookie to every request to business.tejotime.com and
 *                       admin.tejotime.com — sending a marketing-site consent record, and its
 *                       visitorId, to the owner portal and the admin panel on every API call.
 *                       That is both a privacy leak and a needless bytes-per-request cost.
 *   (not HttpOnly)      the provider is a client component and must read this to decide whether
 *                       to show the banner. Nothing secret is stored in it.
 */
export function writeConsent(categories: Omit<ConsentCategories, "necessary">): ConsentRecord {
  const record: ConsentRecord = {
    visitorId: newVisitorId(),
    necessary: true,
    analytics: categories.analytics,
    marketing: categories.marketing,
    preferences: categories.preferences,
    timestamp: new Date().toISOString(),
    version: CONSENT_VERSION,
  };
  if (!isBrowser()) return record;

  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(record))}` +
    `; Max-Age=${CONSENT_MAX_AGE_SECONDS}` +
    `; Path=/` +
    `; SameSite=Lax` +
    secure;
  return record;
}

/**
 * Delete any Google Analytics cookies currently present.
 *
 * Called when analytics consent is WITHDRAWN. Turning the Consent Mode signal to `denied` stops
 * future collection but leaves the existing `_ga` identifier sitting in the browser, so
 * withdrawing consent has to remove it too or the visitor stays identifiable by the cookie they
 * just revoked.
 *
 * A cookie can only be deleted with the same Path/Domain it was set with, and GA sets its
 * cookies on the registrable domain (`.example.com`). Since we cannot read a cookie's attributes
 * back, this fires an expiry for each plausible combination; the ones that do not match are
 * simply no-ops.
 */
export function clearAnalyticsCookies(): void {
  if (!isBrowser()) return;
  const names = document.cookie
    .split("; ")
    .map((row) => row.split("=")[0])
    .filter((name) => name && ANALYTICS_COOKIE_PREFIXES.some((p) => name.startsWith(p)));
  if (names.length === 0) return;

  const host = location.hostname;
  const parts = host.split(".");
  // e.g. "www.tejotime.com" → ["www.tejotime.com", "tejotime.com"] (plus the leading-dot forms).
  const domains: (string | null)[] = [null, host, `.${host}`];
  if (parts.length > 2) {
    const registrable = parts.slice(-2).join(".");
    domains.push(registrable, `.${registrable}`);
  }

  for (const name of names) {
    for (const domain of domains) {
      document.cookie =
        `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/` +
        (domain ? `; Domain=${domain}` : "");
    }
  }
}

/** True when a stored record exists AND was made against the current policy version. */
export function isCurrent(record: ConsentRecord | null): record is ConsentRecord {
  return !!record && record.version === CONSENT_VERSION;
}

/** The category half of a record, for pre-loading the modal's toggles. */
export function categoriesOf(record: ConsentRecord | null): ConsentCategories {
  if (!record) return DEFAULT_CATEGORIES;
  return {
    necessary: true,
    analytics: record.analytics,
    marketing: record.marketing,
    preferences: record.preferences,
  };
}
