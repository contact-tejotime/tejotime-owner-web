import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A store's timezone decides its "Open now · till 6:00 PM", its daily token reset and its analytics
 * day. The admin form never sent one, so every store — a Florida barbershop included — landed on
 * Asia/Kolkata. This pins the resolver and the two writers (create derives from the phone number;
 * update KEEPS the stored zone instead of resetting it). No DB: the pool is stubbed.
 */

const { one, queries } = vi.hoisted(() => ({
  one: vi.fn(),
  queries: [] as { sql: string; params: unknown[] }[],
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one,
  transaction: vi.fn(async (cb: (c: unknown) => Promise<unknown>) =>
    cb({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        // Only the business insert needs an id back; the child-table selects must look empty.
        return { rows: /insert into business \(/.test(sql) ? [{ id: 'b-new' }] : [] };
      },
    }),
  ),
  pool: { on: vi.fn() },
}));

describe('timezoneForPhone', () => {
  it('maps dial codes and US area codes to a zone', async () => {
    const { timezoneForPhone } = await import('../../src/lib/phone-timezone');
    expect(timezoneForPhone('91', '9399385943')).toBe('Asia/Kolkata');
    expect(timezoneForPhone('44', '7700900123')).toBe('Europe/London');
    expect(timezoneForPhone('1', '2125550100')).toBe('America/New_York');
    expect(timezoneForPhone('1', '3055550100')).toBe('America/New_York'); // Miami
    expect(timezoneForPhone('1', '3125550100')).toBe('America/Chicago');
    expect(timezoneForPhone('1', '3075550100')).toBe('America/Denver'); // Wyoming
    expect(timezoneForPhone('1', '6025550100')).toBe('America/Phoenix');
    expect(timezoneForPhone('1', '2135550100')).toBe('America/Los_Angeles');
    expect(timezoneForPhone('1', '8085550100')).toBe('Pacific/Honolulu');
  });

  it('falls back to Eastern for an unlisted +1 code and null for an unknown country', async () => {
    const { timezoneForPhone } = await import('../../src/lib/phone-timezone');
    expect(timezoneForPhone('1', '5005550100')).toBe('America/New_York');
    expect(timezoneForPhone('999', '123456')).toBeNull();
  });

  it('tolerates formatting characters in either part', async () => {
    const { timezoneForPhone } = await import('../../src/lib/phone-timezone');
    expect(timezoneForPhone('+1', '(213) 555-0100')).toBe('America/Los_Angeles');
  });

  it('isValidTimezone accepts IANA names and rejects junk', async () => {
    const { isValidTimezone } = await import('../../src/lib/phone-timezone');
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('admin store timezone writers', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    queries.length = 0;
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
  });

  const store = (o: Record<string, unknown> = {}) => ({
    name: 'Empire Cutz',
    countryCode: '1',
    phoneNumber: '2135550100',
    hours: [],
    amenities: [],
    gallery: [],
    services: [],
    staff: [],
    ...o,
  });

  /** Value bound to `timezone` in the business insert / update, whichever statement carries it. */
  function timezoneWritten(): unknown {
    const q = queries.find((x) => /insert into business \(|update business set/.test(x.sql));
    if (!q) throw new Error('no business write captured');
    const insert = /insert into business \(([^)]*)\)/.exec(q.sql);
    const names = insert
      ? insert[1]!.split(',').map((c) => c.trim())
      : /update business set (.*) where/s.exec(q.sql)![1]!.split(',').map((c) => c.split('=')[0]!.trim());
    return q.params[names.indexOf('timezone')];
  }

  it('create derives the zone from the phone number when none is sent', async () => {
    one.mockResolvedValue(null);
    const { createBusiness } = await import('../../src/modules/admin/admin.service');
    await createBusiness({ ...store(), owner: { password: 'secret123' } } as any, 'admin-1');
    expect(timezoneWritten()).toBe('America/Los_Angeles');
  });

  it('create still honours an explicit zone over the number', async () => {
    one.mockResolvedValue(null);
    const { createBusiness } = await import('../../src/modules/admin/admin.service');
    await createBusiness({ ...store({ timezone: 'America/New_York' }), owner: { password: 'secret123' } } as any, 'admin-1');
    expect(timezoneWritten()).toBe('America/New_York');
  });

  it('create for an Indian number keeps Asia/Kolkata', async () => {
    one.mockResolvedValue(null);
    const { createBusiness } = await import('../../src/modules/admin/admin.service');
    await createBusiness(
      { ...store({ countryCode: '91', phoneNumber: '9399385943' }), owner: { password: 'secret123' } } as any,
      'admin-1',
    );
    expect(timezoneWritten()).toBe('Asia/Kolkata');
  });

  // Regression: an edit that omitted `timezone` reset it to the env default on every save.
  it('update KEEPS the stored zone when the payload omits it', async () => {
    one.mockImplementation(async (sql: string) =>
      /from business where id/.test(sql)
        ? { id: 'b1', currency: 'USD', theme_color: null, phone_full: '12135550100', timezone: 'America/New_York' }
        : null,
    );
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');
    await updateBusiness('b1', store() as any);
    expect(timezoneWritten()).toBe('America/New_York');
  });

  it('update applies an explicit zone', async () => {
    one.mockImplementation(async (sql: string) =>
      /from business where id/.test(sql)
        ? { id: 'b1', currency: 'USD', theme_color: null, phone_full: '12135550100', timezone: 'Asia/Kolkata' }
        : null,
    );
    const { updateBusiness } = await import('../../src/modules/admin/admin.service');
    await updateBusiness('b1', store({ timezone: 'America/New_York' }) as any);
    expect(timezoneWritten()).toBe('America/New_York');
  });
});
