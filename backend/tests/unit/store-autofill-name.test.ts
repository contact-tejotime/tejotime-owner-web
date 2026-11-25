import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /admin/store-name-search and /admin/store-name-fill — "autofill a store from a business
 * name". Drives the real admin router, error handler, category-content, mapping and sanitiser.
 * Stubbed: the database, the admin service (identity + category lookup), the website fetch and the
 * photo byte download (safe-fetch), the bucket upload (storage), and all HTTP (global fetch) for
 * Google Places and Groq — so no network and no real keys. The SSRF guard itself is covered in
 * safe-fetch.test.ts.
 */

const { adminState, safeTextMock, safeBufferMock, uploadMock } = vi.hoisted(() => ({
  adminState: { role: 'owner' as 'owner' | 'employee' },
  safeTextMock: vi.fn(),
  safeBufferMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one: vi.fn(),
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/modules/admin/admin.service', () => ({
  getActiveAdminByMobile: vi.fn(async () => ({ id: 'admin-1', mobile: '919999999999', name: 'A', role: adminState.role })),
  listLookups: vi.fn(async () => ({
    data: [
      { id: '1', name: 'Salon & Barber' },
      { id: '2', name: 'Hospital' },
      { id: '3', name: 'Restaurant' },
    ],
  })),
}));

vi.mock('../../src/lib/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/safe-fetch')>();
  // Default: no readable website (so the website-read path is a no-op unless a test opts in) and a
  // tiny JPEG for any photo download. A plain Error is used (not actual.SafeFetchError) on purpose —
  // instantiating the real class in the factory pins a second copy of it across the test-module
  // registry and breaks another file's `instanceof SafeFetchError` check; readWebsite treats any
  // throw as "couldn't read the website" regardless of the error type.
  safeTextMock.mockRejectedValue(new Error('no site'));
  safeBufferMock.mockResolvedValue({ finalUrl: 'https://img.example/p.jpg', contentType: 'image/jpeg', body: Buffer.from('jpegbytes') });
  return { ...actual, safeFetchText: safeTextMock, safeFetchBuffer: safeBufferMock };
});

vi.mock('../../src/integrations/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/storage')>();
  uploadMock.mockImplementation(async (_ct: string, prefix: string) => ({
    fileKey: `${prefix}/x.jpg`,
    publicUrl: `http://localhost:8080/media/${prefix}/x.jpg`,
  }));
  return { ...actual, uploadBuffer: uploadMock };
});

const SEARCH = '/api/v1/admin/store-name-search';
const FILL = '/api/v1/admin/store-name-fill';

const US_BARBER_DETAILS = {
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
  websiteUri: 'https://www.instagram.com/downtownbarber/', // social → website read is skipped
  googleMapsUri: 'https://maps.google.com/?cid=1',
  googleMapsLinks: { writeAReviewUri: 'https://search.google.com/local/writereview?placeid=xyz' },
  regularOpeningHours: { periods: [{ open: { day: 2, hour: 9 }, close: { day: 2, hour: 18 } }] },
  photos: [{ name: 'places/place-us/photos/AbC_123' }],
  reviews: [{ rating: 5, text: { text: 'Best cuts in town.' }, authorAttribution: { displayName: 'Sam' } }],
};

describe('admin store name autofill', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  // Per-test response data (plain objects; the fetch mock wraps a FRESH Response each call, since a
  // Response body can be read only once and some tests call an endpoint many times).
  let searchData: unknown[];
  let detailsData: Record<string, unknown> | null;
  let copyData: Record<string, unknown> | null;
  let extractData: Record<string, unknown>;
  let photoData: Record<string, unknown>;

  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const groq = (obj: unknown) => json({ choices: [{ message: { content: JSON.stringify(obj) } }] });

  beforeEach(() => {
    vi.resetModules();
    safeTextMock.mockClear();
    safeBufferMock.mockClear();
    uploadMock.mockClear();
    adminState.role = 'owner';

    searchData = [
      { id: 'p1', displayName: { text: 'Downtown Barbershop' }, formattedAddress: '12 Main St, Austin', primaryType: 'barber_shop', primaryTypeDisplayName: { text: 'Barber shop' }, businessStatus: 'OPERATIONAL' },
      { id: 'p2', displayName: { text: 'Downtown Barber Co' }, formattedAddress: '9 2nd St, Austin', businessStatus: 'CLOSED_PERMANENTLY' },
    ];
    detailsData = { ...US_BARBER_DETAILS };
    copyData = {
      headline: 'Fresh and fast',
      heroSubtitle: 'Book in seconds',
      aboutHeading: 'About us',
      description: 'A friendly barbershop. Join the line from your phone and come in when it is your turn, or book ahead.',
      faqs: [{ q: 'Can I walk in?', a: 'Yes — join the line from your phone.' }],
    };
    extractData = {};
    photoData = { photoUri: 'https://lh3.googleusercontent.com/p/photo' };

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: unknown, init: any) => {
      const u = String(url);
      if (u.includes('places:searchText')) return json({ places: searchData });
      if (u.includes('/media?')) return json(photoData);
      if (u.includes('/places/')) return detailsData === null ? json({ error: { message: 'not found' } }, 404) : json(detailsData);
      if (u.includes('api.groq.com')) {
        const system = JSON.parse(String(init.body)).messages[0].content as string;
        if (/marketing copy/i.test(system)) return copyData === null ? json({ error: { message: 'rate limited' } }, 429) : groq(copyData);
        return groq(extractData); // website extractor
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    setEnv({ AUTOFILL_ENABLED: 'true', AUTOFILL_API_KEY: 'test-groq-key', GOOGLE_MAPS_API_KEY: 'test-maps-key', AUTOFILL_DAILY_LIMIT: '50' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  function setEnv(extra: Record<string, string>) {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      S3_ENDPOINT: 'https://example.storageapi.dev',
      S3_ACCESS_KEY_ID: 'test-access-key-id',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      S3_BUCKET: 'test-bucket',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
      ...extra,
    };
  }

  async function app() {
    const { adminRouter } = await import('../../src/modules/admin/admin.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/admin', adminRouter);
    a.use(errorHandler);
    return a;
  }

  async function authed(a: express.Express, path: string, body: unknown) {
    const { signAdminToken } = await import('../../src/modules/auth/token.service');
    return request(a).post(path).set('authorization', `Bearer ${signAdminToken('919999999999')}`).send(body as object);
  }

  // ---- access + validation ------------------------------------------------

  it('401 without an admin token (search)', async () => {
    const res = await request(await app()).post(SEARCH).send({ query: 'barber austin' });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 for an OWNER-app access token', async () => {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    const token = signAccessToken({ userId: 'u1', businessId: 'b1', role: 'owner' as any, plan: 'free' as any, staffId: null });
    const res = await request(await app()).post(SEARCH).set('authorization', `Bearer ${token}`).send({ query: 'barber austin' });
    expect(res.status).toBe(401);
  });

  it.each([
    ['search: missing query', SEARCH, {}],
    ['search: too short', SEARCH, { query: 'x' }],
    ['search: unknown key', SEARCH, { query: 'barber austin', foo: 1 }],
    ['fill: missing placeId', FILL, {}],
    ['fill: empty placeId', FILL, { placeId: ' ' }],
  ])('400 on %s', async (_label, path, body) => {
    const res = await authed(await app(), path, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('503 when the Google key is blank — and it never calls Google', async () => {
    setEnv({ AUTOFILL_ENABLED: 'true', AUTOFILL_API_KEY: 'k', GOOGLE_MAPS_API_KEY: '' });
    const res = await authed(await app(), SEARCH, { query: 'barber austin' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTOFILL_DISABLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503 when autofill is disabled entirely', async () => {
    setEnv({ AUTOFILL_ENABLED: 'false', GOOGLE_MAPS_API_KEY: 'k' });
    const res = await authed(await app(), FILL, { placeId: 'p1' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTOFILL_DISABLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- search -------------------------------------------------------------

  it('returns candidates (with the closed-permanently status passed through)', async () => {
    const res = await authed(await app(), SEARCH, { query: 'downtown barber austin' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(2);
    expect(res.body.candidates[0]).toMatchObject({ placeId: 'p1', name: 'Downtown Barbershop' });
    expect(res.body.candidates[1].businessStatus).toBe('CLOSED_PERMANENTLY');
  });

  it('an employee admin may use it', async () => {
    adminState.role = 'employee';
    const res = await authed(await app(), SEARCH, { query: 'barber austin' });
    expect(res.status).toBe(200);
  });

  // ---- fill ---------------------------------------------------------------

  it('maps Google details, snaps the category, copies photos to our bucket, and writes copy', async () => {
    const res = await authed(await app(), FILL, { placeId: 'place-us' });
    expect(res.status).toBe(200);
    const { fields, source } = res.body;

    expect(source).toEqual({ url: 'https://maps.google.com/?cid=1', title: 'Downtown Barbershop' });
    expect(fields).toMatchObject({
      name: 'Downtown Barbershop',
      area: 'Downtown',
      city: 'Austin',
      countryCode: '1',
      phoneNumber: '5125550199',
      rating: 4.9,
      reviewCount: 540,
      category: 'Salon & Barber', // barbershop preset → Salon & Barber
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=xyz',
    });
    // Copy from the LLM.
    expect(fields.tagline).toBe('Fresh and fast');
    // Photo copied into OUR bucket (never a googleusercontent URL).
    expect(fields.heroImageUrl).toMatch(/\/media\/admin\/hero\//);
    expect(fields.heroImageUrl).not.toMatch(/googleusercontent/);
    expect(uploadMock).toHaveBeenCalled();
    // Starter services (no website) are suggestions with no price.
    expect(fields.services.length).toBeGreaterThan(0);
    expect(fields.services.every((s: any) => s.priceType === 'unset')).toBe(true);
    // Reviews come through (the client defaults them OFF).
    expect(fields.reviews).toEqual([{ stars: 5, text: 'Best cuts in town.', authorName: 'Sam' }]);
  });

  it('falls back to the compliant template when the copy model is rate-limited (no throw)', async () => {
    copyData = null; // 429 from the copy call
    const res = await authed(await app(), FILL, { placeId: 'place-us' });
    expect(res.status).toBe(200);
    // The barbershop template's first headline.
    expect(res.body.fields.tagline).toBe('Fresh cuts, no waiting around');
  });

  it('reads the business website for services when it is a real site', async () => {
    detailsData = { ...US_BARBER_DETAILS, websiteUri: 'https://downtownbarber.example' };
    extractData = {
      services: [{ name: 'Skin fade', durationMinutes: 30, price: 25 }],
      staff: [{ name: 'Marco', role: 'Master barber' }],
    };
    safeTextMock.mockResolvedValueOnce({ finalUrl: 'https://downtownbarber.example/', contentType: 'text/html', body: '<html><body>Skin fade $25</body></html>' });
    const res = await authed(await app(), FILL, { placeId: 'place-us' });
    expect(res.status).toBe(200);
    expect(res.body.fields.services).toEqual([{ name: 'Skin fade', durationMinutes: 30, priceRupees: 25, priceType: 'fixed', priceMaxRupees: null }]);
    expect(res.body.fields.staff).toEqual([{ name: 'Marco', roleLabel: 'Master barber' }]);
  });

  it('amenities: Google first, then the website (canonical names, unmatched dropped), and the rest only suggested', async () => {
    detailsData = {
      ...US_BARBER_DETAILS,
      websiteUri: 'https://downtownbarber.example',
      parkingOptions: { freeParkingLot: true },
      paymentOptions: { acceptsNfc: true },
    };
    // The website lists AC and Wi-Fi in its own words, plus two things with no honest match.
    extractData = { amenities: ['AC', 'Free WiFi', 'Parking available', 'Bowling alley'] };
    safeTextMock.mockResolvedValueOnce({ finalUrl: 'https://downtownbarber.example/', contentType: 'text/html', body: '<html><body>AC, Free WiFi</body></html>' });

    const res = await authed(await app(), FILL, { placeId: 'place-us' });
    expect(res.status).toBe(200);
    // A (Google) then B (website) — confirmed and filled. The NFC payment flag adds nothing.
    expect(res.body.fields.amenities).toEqual(['Free parking', 'Air conditioned', 'Free Wi-Fi']);
    // C — the barbershop's typical amenities, minus the confirmed ones. Offered, never filled.
    expect(res.body.fields.suggestedAmenities).toEqual(['Waiting area', 'TV', 'Complimentary drinks', 'Phone charging']);
  });

  it('asks Google for the amenity fields', async () => {
    await authed(await app(), FILL, { placeId: 'place-us' });
    const detailsCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/places/place-us'))!;
    const mask = (detailsCall[1] as RequestInit & { headers: Record<string, string> }).headers['x-goog-fieldmask'];
    for (const field of ['parkingOptions', 'accessibilityOptions', 'restroom', 'goodForChildren', 'allowsDogs']) {
      expect(mask.split(',')).toContain(field);
    }
    // Payment options are not fetched — nothing uses them.
    expect(mask.split(',')).not.toContain('paymentOptions');
  });

  it('422 when the place cannot be loaded from Google', async () => {
    detailsData = null;
    const res = await authed(await app(), FILL, { placeId: 'nope' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PLACE_NOT_FOUND');
  });

  it('enforces the daily lookup limit (503 after the cap)', async () => {
    setEnv({ AUTOFILL_ENABLED: 'true', AUTOFILL_API_KEY: 'k', GOOGLE_MAPS_API_KEY: 'k', AUTOFILL_DAILY_LIMIT: '1' });
    const a = await app();
    const first = await authed(a, FILL, { placeId: 'place-us' });
    expect(first.status).toBe(200);
    const second = await authed(a, FILL, { placeId: 'place-us' });
    expect(second.status).toBe(503);
    expect(second.body.error.code).toBe('AUTOFILL_DAILY_LIMIT_REACHED');
  });

  it('rate-limits fill to 10 per hour per admin', async () => {
    const a = await app();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await authed(a, FILL, { placeId: 'place-us' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
