import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A store's phone number is its web address (`/{phone_full}`) and is printed in every QR code,
 * so once set it must not change. The admin form greys the field out, but that is cosmetic: this
 * pins the API guard in `updateBusiness`, with the database stubbed (no DB, no server).
 *
 * Not a smoke-script E2E: the seed creates no platform admin, so the Tier-1 scripts have no admin
 * login to drive `PUT /admin/businesses/:id` with.
 */

const { one, transaction } = vi.hoisted(() => ({
  one: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one,
  transaction,
  pool: { on: vi.fn() },
}));

/** Sentinel: the guard let the update through and it reached the write. */
const REACHED_WRITE = new Error('reached-write');

const STORE_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

function input(countryCode: string, phoneNumber: string) {
  return {
    name: 'Curv Beauty',
    category: 'Salon',
    area: 'Downtown',
    address: '1 Main St',
    city: 'Naples',
    tagline: 'Hair and beauty',
    description: 'A salon.',
    aboutHeading: 'About us',
    countryCode,
    phoneNumber,
    hours: [],
    amenities: [],
    gallery: [],
    services: [],
    staff: [],
    faqs: [],
    reviews: [],
  } as never;
}

describe('admin updateBusiness: phone number is locked once set', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    transaction.mockReset();
    transaction.mockRejectedValue(REACHED_WRITE);
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
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  /** First `one()` is the existing row; any later one (the phone-in-use check) finds nothing. */
  function existingPhone(phoneFull: string | null) {
    one.mockResolvedValueOnce({ id: STORE_ID, currency: 'USD', theme_color: null, phone_full: phoneFull });
    one.mockResolvedValue(null);
  }

  it('refuses a different number with 409 PHONE_LOCKED and writes nothing', async () => {
    existingPhone('12393160008');
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');

    const err = await updateBusiness(STORE_ID, input('1', '2393160009')).catch((e) => e);

    expect(err).toMatchObject({ httpStatus: 409, code: 'PHONE_LOCKED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a changed country code on the same national number', async () => {
    existingPhone('12393160008');
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');

    const err = await updateBusiness(STORE_ID, input('91', '2393160008')).catch((e) => e);

    expect(err).toMatchObject({ httpStatus: 409, code: 'PHONE_LOCKED' });
  });

  it('lets an edit through when the number is unchanged', async () => {
    existingPhone('12393160008');
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');

    await expect(updateBusiness(STORE_ID, input('1', '2393160008'))).rejects.toBe(REACHED_WRITE);
  });

  it('lets a legacy store with no number set one', async () => {
    existingPhone(null);
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');

    await expect(updateBusiness(STORE_ID, input('1', '2393160008'))).rejects.toBe(REACHED_WRITE);
  });
});
