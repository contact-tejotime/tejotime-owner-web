/**
 * Google Consent Mode v2 plumbing.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * TEJOTIME SHIPS NO ANALYTICS OR MARKETING TAGS TODAY.
 *
 * There is no Google Analytics, no GTM, no Meta Pixel, no Hotjar, no Segment and no Sentry
 * anywhere in this repo, and this file does not add one. It exists so that the consent signal is
 * already correct on the day someone does add a tag — the failure mode being guarded against is
 * the usual one: a tag gets pasted into the layout months from now, fires before the consent
 * state is known, and collects from EU visitors who never agreed.
 *
 * Consent Mode works by having the DENIED defaults pushed BEFORE any Google tag loads. Once a
 * tag has loaded without that, the window is gone. So the defaults go out on every first paint,
 * whether or not a tag exists.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * TO ENABLE GOOGLE ANALYTICS LATER:
 *   1. Set NEXT_PUBLIC_GA_MEASUREMENT_ID (e.g. "G-XXXXXXXXXX") in the frontend environment.
 *      Remember NEXT_PUBLIC_* are baked at BUILD time — redeploy, do not just restart.
 *   2. Nothing else. `loadAnalyticsIfAllowed()` already injects gtag.js, but only once the
 *      visitor has consented to analytics; with the variable unset it is a no-op.
 *   3. Add the GA cookies to the table in `t.cookies` in i18n/en.json and to
 *      docs/cookie-consent-v1.md. A cookie policy that lists cookies you do not set is worse
 *      than none at all, which is why that table is currently free of them.
 *   4. Review whether `marketing` should also gate ad_* signals for your GA configuration.
 */
import type { ConsentCategories } from "./consent";

type GtagArgs = unknown[];

declare global {
  interface Window {
    dataLayer?: GtagArgs[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Consent Mode v2 signal names, split by the category that governs each. */
const ANALYTICS_SIGNALS = ["analytics_storage"] as const;
const MARKETING_SIGNALS = ["ad_storage", "ad_user_data", "ad_personalization"] as const;
/** Governed by `preferences`; Google treats these as functional storage. */
const PREFERENCE_SIGNALS = ["functionality_storage", "personalization_storage"] as const;

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Queue a gtag call.
 *
 * Google's published snippet pushes the `arguments` object; what its tag actually consumes is
 * anything array-LIKE (it reads `[0]`, `[1]`, `.length`), so a real array is equivalent and
 * avoids mixing `arguments` with rest parameters. Pushing to `dataLayer` before any tag exists
 * is the whole point — a tag loading later replays the queue in order.
 */
function gtag(...args: unknown[]): void {
  if (!isBrowser()) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

const granted = (on: boolean) => (on ? "granted" : "denied");

/**
 * Push denied-by-default consent signals. Safe to call with no tag present: it only seeds
 * `window.dataLayer`, which any tag loading later will replay in order.
 *
 * Call this as early as possible on every page load, BEFORE any third-party script.
 */
export function initConsentModeDefaults(): void {
  if (!isBrowser()) return;
  const denied: Record<string, string> = { security_storage: "granted" };
  for (const s of [...ANALYTICS_SIGNALS, ...MARKETING_SIGNALS, ...PREFERENCE_SIGNALS]) {
    denied[s] = "denied";
  }
  // `wait_for_update` gives our own banner a moment to resolve a stored choice before a tag
  // (if one is ever present) decides it has been denied.
  denied.wait_for_update = "500";
  gtag("consent", "default", denied);
}

/** Push the visitor's actual choices. Called on every save, including a withdrawal. */
export function updateConsentMode(categories: ConsentCategories): void {
  if (!isBrowser()) return;
  const update: Record<string, string> = {};
  for (const s of ANALYTICS_SIGNALS) update[s] = granted(categories.analytics);
  for (const s of MARKETING_SIGNALS) update[s] = granted(categories.marketing);
  for (const s of PREFERENCE_SIGNALS) update[s] = granted(categories.preferences);
  gtag("consent", "update", update);
}

let analyticsInjected = false;

/**
 * Inject gtag.js — but only when a measurement id is configured AND analytics is consented.
 *
 * With NEXT_PUBLIC_GA_MEASUREMENT_ID unset (the state today) this does nothing at all, so no
 * network request is made and no cookie is set. Idempotent: repeated calls inject once.
 */
export function loadAnalyticsIfAllowed(categories: ConsentCategories): void {
  if (!isBrowser() || !GA_ID || !categories.analytics || analyticsInjected) return;
  analyticsInjected = true;

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);

  gtag("js", new Date());
  // No cookie flags beyond the defaults here; revisit alongside step 4 of the enable checklist.
  gtag("config", GA_ID);
}
