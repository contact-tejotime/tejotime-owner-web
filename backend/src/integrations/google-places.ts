import { env } from '../config/env';
import { logger } from '../config/logger';
import type { GoogleAmenityFacts } from '../lib/amenities';

/**
 * Google Places API (New) — the data source behind "autofill a store from a business name"
 * (docs/store-autofill-from-name.md). A flag-/key-gated seam shaped like integrations/store-extract.ts:
 * `configured` tells the service whether to run, and the methods NEVER throw — any failure resolves to
 * `null`/`[]`, and the service turns that into a readable error rather than a 500.
 *
 * The key stays here and travels in the `X-Goog-Api-Key` HEADER, never the query string — pino logs
 * request URLs, so a key in the URL would leak. Field selection is a header too (`X-Goog-FieldMask`);
 * the masks are kept as small as each call needs, because Places bills per returned field group.
 */

export interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress: string;
  primaryType?: string;
  primaryTypeDisplayName?: string;
  types?: string[];
  businessStatus?: string;
}

interface TimePoint {
  day?: number;
  hour?: number;
  minute?: number;
}

/**
 * Close to Google's raw details JSON on purpose, so `mapPlaceToFields` can be tested with it. The
 * amenity flags (parkingOptions, accessibilityOptions, restroom, goodForChildren, allowsDogs)
 * come from GoogleAmenityFacts.
 */
export interface PlaceDetails extends GoogleAmenityFacts {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { periods?: Array<{ open?: TimePoint; close?: TimePoint }> };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  googleMapsUri?: string;
  googleMapsLinks?: { reviewsUri?: string; writeAReviewUri?: string };
  editorialSummary?: { text?: string };
  photos?: Array<{ name: string; widthPx?: number; heightPx?: number; authorAttributions?: Array<{ displayName?: string; uri?: string }> }>;
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
    relativePublishTimeDescription?: string;
  }>;
}

export interface GooglePlaces {
  readonly configured: boolean;
  searchText(query: string, opts?: { regionCode?: string }): Promise<PlaceCandidate[]>;
  placeDetails(placeId: string): Promise<PlaceDetails | null>;
  /** Resolve a `places/{id}/photos/{ref}` name to a short-lived bytes URL the service then SSRF-fetches. */
  photoMediaUri(photoName: string, maxWidthPx: number): Promise<string | null>;
}

const PLACES_BASE = 'https://places.googleapis.com/v1';

const SEARCH_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.businessStatus',
].join(',');

const DETAILS_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'shortFormattedAddress',
  'addressComponents',
  'location',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'types',
  'primaryType',
  'businessStatus',
  'googleMapsUri',
  'googleMapsLinks',
  'editorialSummary',
  'photos',
  'reviews',
  // Amenities (lib/amenities.ts amenitiesFromGoogle). These sit in the same top billing tier as
  // `reviews`/`editorialSummary`, which this mask already requests. No paymentOptions: payment
  // methods are not amenities, and nothing else reads them.
  'parkingOptions',
  'accessibilityOptions',
  'restroom',
  'goodForChildren',
  'allowsDogs',
].join(',');

/** Google photo resource names look exactly like this; reject anything else before interpolating. */
const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

const configured = env.AUTOFILL_ENABLED && env.GOOGLE_MAPS_API_KEY.trim().length > 0;

/** Never throws; logs and returns null on any non-2xx, network error or timeout. */
async function googleFetch(method: 'GET' | 'POST', url: string, fieldMask: string | null, body?: unknown): Promise<any | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GOOGLE_MAPS_API_KEY,
        ...(fieldMask ? { 'x-goog-fieldmask': fieldMask } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(env.AUTOFILL_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err }, 'google places request threw (timeout or network)');
    return null;
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    // Never log the URL (it would be fine — the key is a header — but keep it tidy); log the reason.
    logger.warn({ status: res.status, error: json?.error?.message ?? null }, 'google places error');
    return null;
  }
  return json;
}

export const googlePlaces: GooglePlaces = {
  configured,

  async searchText(query, opts) {
    if (!configured) return [];
    const json = await googleFetch('POST', `${PLACES_BASE}/places:searchText`, SEARCH_MASK, {
      textQuery: query,
      pageSize: 5,
      languageCode: 'en',
      ...(opts?.regionCode ? { regionCode: opts.regionCode } : {}),
    });
    const places = Array.isArray(json?.places) ? json.places : [];
    return places
      .map((p: any): PlaceCandidate | null => {
        if (typeof p?.id !== 'string') return null;
        return {
          placeId: p.id,
          name: typeof p.displayName?.text === 'string' ? p.displayName.text : p.id,
          formattedAddress: typeof p.formattedAddress === 'string' ? p.formattedAddress : '',
          primaryType: typeof p.primaryType === 'string' ? p.primaryType : undefined,
          primaryTypeDisplayName: typeof p.primaryTypeDisplayName?.text === 'string' ? p.primaryTypeDisplayName.text : undefined,
          types: Array.isArray(p.types) ? p.types.filter((t: unknown) => typeof t === 'string') : undefined,
          businessStatus: typeof p.businessStatus === 'string' ? p.businessStatus : undefined,
        };
      })
      .filter((p: PlaceCandidate | null): p is PlaceCandidate => p !== null);
  },

  async placeDetails(placeId) {
    if (!configured) return null;
    const json = await googleFetch('GET', `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, DETAILS_MASK);
    return json && typeof json === 'object' && typeof json.id === 'string' ? (json as PlaceDetails) : null;
  },

  async photoMediaUri(photoName, maxWidthPx) {
    if (!configured) return null;
    // Defence in depth: the photo name comes from a details response, but validating it keeps this
    // method from being coaxed into fetching an arbitrary path (and matters for the future fallback).
    if (!PHOTO_NAME_RE.test(photoName)) {
      logger.warn({ photoName }, 'rejected malformed google photo name');
      return null;
    }
    // skipHttpRedirect=true returns JSON { name, photoUri } instead of a 302, so the key never rides
    // along to the googleusercontent host the service then fetches (and that fetch is SSRF-guarded).
    const url = `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`;
    const json = await googleFetch('GET', url, null);
    return typeof json?.photoUri === 'string' ? json.photoUri : null;
  },
};

// ---------------------------------------------------------------------------
// Daily cost guard — a soft, in-process cap on billable lookups (one per "fill").
// The backend runs a single replica (CLAUDE.md §9), so an in-memory counter is consistent with the
// rate limiters; it resets on deploy, which is fine for a soft cap. Google Cloud's own daily quota
// is the hard backstop (see the doc).
// ---------------------------------------------------------------------------

let dayKey = '';
let dayCount = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

/**
 * Reserve one lookup against today's budget. Returns false (and reserves nothing) once the day's
 * limit is reached. Call it once, immediately before a billable Place Details fill.
 */
export function consumeDailyLookup(): boolean {
  const key = today();
  if (key !== dayKey) {
    dayKey = key;
    dayCount = 0;
  }
  if (dayCount >= env.AUTOFILL_DAILY_LIMIT) return false;
  dayCount += 1;
  return true;
}
