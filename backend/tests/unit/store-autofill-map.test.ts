import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

// Mock the heavy, stateful deps the service graph pulls in. The mapping functions under test are
// pure and never call these, but loading the REAL safe-fetch module here leaves a realised copy in
// the shared test-module registry that breaks a later file's `instanceof SafeFetchError` check
// (store-import.test.ts). Mocking it keeps this file's imports inert and isolated.
vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one: vi.fn(),
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/lib/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/safe-fetch')>();
  return { ...actual, safeFetchText: vi.fn(async () => { throw new Error('no network in this test'); }), safeFetchBuffer: vi.fn() };
});

/**
 * Pure mapping from Google Places (New) details → the Create-a-store form, driven by realistic
 * sample Google JSON (the shapes the real API returns): an Indian beauty parlour with Google's
 * omitted `minute` fields, a Sunday with no period, and Instagram as its website; and a US
 * barbershop with a split-shift day and a +1 phone. No network, no LLM, no photos.
 *
 * The functions under test live in store-autofill.service.ts, which imports the env module (it
 * validates at import), so env is set before a dynamic import — the mapping itself touches neither.
 */

beforeEach(() => {
  // Reset the module registry so the real safe-fetch/service graph this file loads does not leak
  // into a later file whose own vi.mock of safe-fetch relies on a single module identity
  // (store-import.test.ts checks `err instanceof SafeFetchError`).
  vi.resetModules();
  process.env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
    S3_ENDPOINT: 'https://example.storageapi.dev',
    S3_ACCESS_KEY_ID: 'a',
    S3_SECRET_ACCESS_KEY: 'b',
    S3_BUCKET: 'c',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
    TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

const load = () => import('../../src/modules/admin/store-autofill.service');

const IN_PARLOUR = {
  id: 'place-in',
  displayName: { text: 'Om Beauty Parlour' },
  formattedAddress: 'Shop 4, Mota Varachha Rd, Surat, Gujarat 394101, India',
  addressComponents: [
    { longText: 'Mota Varachha', shortText: 'Mota Varachha', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { longText: 'Surat', shortText: 'Surat', types: ['locality', 'political'] },
    { longText: 'India', shortText: 'IN', types: ['country', 'political'] },
  ],
  internationalPhoneNumber: '+91 98765 43210',
  rating: 4.6,
  userRatingCount: 128,
  googleMapsLinks: { writeAReviewUri: 'https://search.google.com/local/writereview?placeid=abc' },
  types: ['beauty_salon', 'point_of_interest'],
  websiteUri: 'https://www.instagram.com/ombeauty/',
  restroom: true,
  goodForChildren: false, // false adds nothing
  allowsDogs: false,
  regularOpeningHours: {
    periods: [
      // Google omits minute when it is 0.
      { open: { day: 1, hour: 10 }, close: { day: 1, hour: 20 } },
      { open: { day: 2, hour: 10 }, close: { day: 2, hour: 20 } },
      { open: { day: 6, hour: 10, minute: 30 }, close: { day: 6, hour: 21 } },
      // Sunday (day 0) has no period → Closed.
    ],
  },
};

const US_BARBER = {
  id: 'place-us',
  displayName: { text: 'Downtown Barbershop' },
  formattedAddress: '12 Main St, Austin, TX 78701, USA',
  addressComponents: [
    { longText: 'Downtown', shortText: 'Downtown', types: ['neighborhood', 'political'] },
    { longText: 'Austin', shortText: 'Austin', types: ['locality', 'political'] },
    { longText: 'United States', shortText: 'US', types: ['country', 'political'] },
  ],
  internationalPhoneNumber: '+1 512-555-0199',
  rating: 4.9,
  userRatingCount: 540,
  types: ['barber_shop'],
  // Cards + NFC and parking, as Google reports them.
  paymentOptions: { acceptsCreditCards: true, acceptsDebitCards: true, acceptsNfc: true },
  parkingOptions: { freeParkingLot: true, paidStreetParking: false },
  accessibilityOptions: { wheelchairAccessibleEntrance: true },
  regularOpeningHours: {
    periods: [
      // A split shift on Monday: morning and afternoon.
      { open: { day: 1, hour: 9 }, close: { day: 1, hour: 12 } },
      { open: { day: 1, hour: 13 }, close: { day: 1, hour: 18 } },
      { open: { day: 2, hour: 9 }, close: { day: 2, hour: 18 } },
    ],
  },
};

describe('mapPlaceToFields — Indian beauty parlour', { timeout: 30_000 }, () => {
  it('maps name, area/city, phone, rating and hours; Sunday closed; omitted minutes become :00', async () => {
    const { mapPlaceToFields, countryOf } = await load();
    const warnings: string[] = [];
    const f = mapPlaceToFields(IN_PARLOUR as never, warnings);

    expect(countryOf(IN_PARLOUR as never)).toBe('IN');
    expect(f.name).toBe('Om Beauty Parlour');
    expect(f.area).toBe('Mota Varachha');
    expect(f.city).toBe('Surat');
    expect(f.countryCode).toBe('91');
    expect(f.phoneNumber).toBe('9876543210');
    expect(f.rating).toBe(4.6);
    expect(f.reviewCount).toBe(128);
    expect(f.googleReviewUrl).toBe('https://search.google.com/local/writereview?placeid=abc');

    const byDay = Object.fromEntries((f.hours ?? []).map((h) => [h.dayOfWeek, h]));
    expect(byDay[1]).toEqual({ dayOfWeek: 1, opensAt: '10:00', closesAt: '20:00', isClosed: false });
    expect(byDay[6]).toEqual({ dayOfWeek: 6, opensAt: '10:30', closesAt: '21:00', isClosed: false });
    expect(byDay[0]!.isClosed).toBe(true); // Sunday absent → closed
    expect(byDay[3]!.isClosed).toBe(true);

    // Amenities from Google: only flags reported TRUE.
    expect(f.amenities).toEqual(['Restroom']);
  });

  it('picks the beauty_parlour preset in India', async () => {
    const { presetFor } = await import('../../src/lib/category-content');
    expect(presetFor(IN_PARLOUR.types, IN_PARLOUR.displayName.text, 'IN')).toBe('beauty_parlour');
  });
});

describe('mapPlaceToFields — US barbershop', { timeout: 30_000 }, () => {
  it('splits a +1 phone, reads the US neighborhood/city, and collapses a split shift with a warning', async () => {
    const { mapPlaceToFields, countryOf, splitInternationalPhone } = await load();
    const warnings: string[] = [];
    const f = mapPlaceToFields(US_BARBER as never, warnings);

    expect(countryOf(US_BARBER as never)).toBe('US');
    expect(f.countryCode).toBe('1');
    expect(f.phoneNumber).toBe('5125550199');
    expect(f.area).toBe('Downtown');
    expect(f.city).toBe('Austin');

    const byDay = Object.fromEntries((f.hours ?? []).map((h) => [h.dayOfWeek, h]));
    // Earliest open, latest close across the two Monday periods.
    expect(byDay[1]).toEqual({ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00', isClosed: false });
    expect(warnings.join(' ')).toMatch(/more than one opening period/);

    // The +1 split must work (parsePhone, the link importer's, rejects +1 on purpose).
    expect(splitInternationalPhone('+1 512-555-0199', 'US')).toEqual({ countryCode: '1', phoneNumber: '5125550199' });

    // Parking and the accessible entrance come straight from Google's flags; its cards/NFC payment
    // flags do not become amenities.
    expect(f.amenities).toEqual(['Free parking', 'Wheelchair accessible entrance']);
  });

  it('picks the barbershop preset', async () => {
    const { presetFor } = await import('../../src/lib/category-content');
    expect(presetFor(US_BARBER.types, US_BARBER.displayName.text, 'US')).toBe('barbershop');
  });
});
