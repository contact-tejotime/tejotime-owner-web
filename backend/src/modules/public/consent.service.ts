import type { Request } from 'express';
import { exec } from '../../db/pool';

/**
 * Cookie-consent audit log (migration 0026).
 *
 * The visitor's own `cookie_consent` cookie is what governs behaviour in their browser. This
 * service exists only so we can DEMONSTRATE consent later — GDPR puts that burden on us, and a
 * cookie the visitor can clear is not evidence.
 *
 * Two rules, both enforced here rather than trusted to the client:
 *
 *  1. `countryCode` is NEVER taken from the request body. A client could send anything, and a
 *     forged "GB" on a record that is supposed to prove where someone was when they consented
 *     would make the whole log worthless. It is read from the CDN's edge header or left null.
 *  2. No IP address and no user agent is stored or logged. The country is deliberately the
 *     coarsest signal that still answers the only question we have of it ("was this visitor
 *     somewhere GDPR applies?"). A full IP would make this row more sensitive than the consent
 *     it documents, and a user agent is a fingerprint.
 */

export interface ConsentInput {
  visitorId: string;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  timestamp: string;
  policyVersion: string;
}

/**
 * Headers set by the edge that fronts the app, in order of preference. Cloudflare and Vercel
 * both resolve the country before the request reaches us; `x-country-code` is the generic
 * fallback some proxies use.
 */
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as const;

/**
 * ISO 3166-1 alpha-2, or null.
 *
 * Cloudflare sends `XX` for an unknown country and `T1` for Tor exits; both are non-answers, so
 * they are normalised to null rather than stored as if they were places. The column is char(2),
 * so anything that is not exactly two letters has to be rejected here or the insert would throw.
 */
export function countryFromHeaders(req: Request): string | null {
  for (const header of COUNTRY_HEADERS) {
    const raw = req.headers[header];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value;
  }
  return null;
}

/**
 * Append one consent record.
 *
 * Append-only: a visitor who changes their mind produces a second row, so the history of what
 * was agreed and when is preserved. `timestamp` is the client's clock and is accepted as the
 * declared moment of choice, while `created_at` is the server's — keeping both means a skewed
 * client clock cannot rewrite when we actually received it.
 */
export async function recordConsent(input: ConsentInput, countryCode: string | null): Promise<void> {
  await exec(
    `insert into consent_log
       (visitor_id, necessary, analytics, marketing, preferences, policy_version, country_code, created_at)
     values ($1, true, $2, $3, $4, $5, $6, $7)`,
    [
      input.visitorId,
      input.analytics,
      input.marketing,
      input.preferences,
      input.policyVersion,
      countryCode,
      new Date(input.timestamp),
    ],
  );
}
