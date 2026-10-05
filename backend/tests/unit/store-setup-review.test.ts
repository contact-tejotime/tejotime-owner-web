import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client's store-setup review (2026-10-05, docs/store-setup-review-2026-10-05.md), through the
 * real admin and owner services and the public microsite builder, with Postgres stubbed:
 *  - 23: the owner-chosen gallery heading is written only when sent ('' clears it), owner-only,
 *        and reaches the page;
 *  - 30: the neighborhood ("area") is optional, and the page gets the city to stand in for it;
 *  - 34: the headline can't be emptied (a blank one is ignored, so old app builds still save);
 *  - 35: the highlight number/caption are accepted from old clients but never stored or returned.
 * The admin router's validation of the same fields is in optional-store-data.test.ts.
 */

const { one, many, exec } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
  exec: vi.fn(async () => 1),
}));

vi.mock('../../src/db/pool', () => ({ one, many, exec, transaction: vi.fn(), pool: { on: vi.fn() } }));
vi.mock('../../src/modules/queue/queue.context', () => ({
  loadQueueContext: vi.fn(async () => ({
    serviceRows: [],
    staffRows: [],
    engineEntries: [],
    engineStaff: [],
    engineServices: [],
  })),
}));

const ROW = {
  id: 'b1',
  slug: 'curv',
  name: 'Curv Beauty',
  category: 'Salon & Barber',
  area: null,
  city: 'Naples',
  address: '1 Main St',
  tagline: 'Look sharp. Skip the wait.',
  gallery_heading: 'Inside the shop',
  stat_value: '30k+',
  stat_label: 'haircuts done',
  country_code: '1',
  phone_number: '2395550199',
  phone_full: '12395550199',
  timezone: 'America/New_York',
  currency: 'USD',
  rating: 4.8,
  review_count: 10,
  is_active: true,
};

describe('store setup review (14 · 23 · 30 · 34 · 35)', { timeout: 30_000 }, () => {
  beforeAll(() => {
    process.env = {
      ...process.env,
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

  beforeEach(() => {
    one.mockReset();
    many.mockReset();
    exec.mockReset();
    many.mockResolvedValue([]);
    exec.mockResolvedValue(1);
    one.mockImplementation(async (sql: string) => (sql.includes('from subscription') ? { plan: 'free' } : { ...ROW }));
  });

  describe('admin store columns', () => {
    const base = { name: 'Curv Beauty', countryCode: '1', phoneNumber: '2395550199', hours: [] } as any;

    it('writes the gallery heading only when sent — an older admin build cannot wipe the owner’s', async () => {
      const { businessColumns } = await import('../../src/modules/admin/admin.service');
      expect(businessColumns(base)).not.toHaveProperty('gallery_heading');
      expect(businessColumns({ ...base, galleryHeading: '' }).gallery_heading).toBeNull();
      expect(businessColumns({ ...base, galleryHeading: '  Inside the shop ' }).gallery_heading).toBe('Inside the shop');
    });

    it('never writes the removed highlight columns, even when an old client sends them', async () => {
      const { businessColumns } = await import('../../src/modules/admin/admin.service');
      const cols = businessColumns({ ...base, statValue: '30k+', statLabel: 'haircuts done' });
      expect(cols).not.toHaveProperty('stat_value');
      expect(cols).not.toHaveProperty('stat_label');
    });

    it('stores a missing neighborhood as NULL (it is optional now)', async () => {
      const { businessColumns } = await import('../../src/modules/admin/admin.service');
      expect(businessColumns(base).area).toBeNull();
    });
  });

  describe('owner profile update', () => {
    const lastUpdate = () => {
      const [sql, params] = exec.mock.calls.at(-1)! as unknown as [string, unknown[]];
      const cols = [...sql.matchAll(/(\w+) = \$\d+/g)].map((m) => m[1]);
      return Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    };

    it('ignores a blank headline and the removed highlight fields; clears the gallery heading with ""', async () => {
      const { updateBusiness } = await import('../../src/modules/business/business.service');
      const dto = await updateBusiness(
        'b1',
        { name: 'Curv', tagline: '   ', statValue: '30k+', statLabel: 'haircuts done', galleryHeading: '' },
        { isOwner: true },
      );
      const set = lastUpdate();
      expect(set.name).toBe('Curv');
      expect(set).not.toHaveProperty('tagline');
      expect(set).not.toHaveProperty('stat_value');
      expect(set).not.toHaveProperty('stat_label');
      expect(set.gallery_heading).toBeNull();
      // The DTO carries the heading and no longer the highlight fields.
      expect(dto.galleryHeading).toBe('Inside the shop');
      expect(dto).not.toHaveProperty('statValue');
      expect(dto).not.toHaveProperty('statLabel');
    });

    it('saves a real headline and a chosen heading', async () => {
      const { updateBusiness } = await import('../../src/modules/business/business.service');
      await updateBusiness('b1', { tagline: 'Care without the long wait', galleryHeading: 'Our facility' }, { isOwner: true });
      expect(lastUpdate()).toMatchObject({ tagline: 'Care without the long wait', gallery_heading: 'Our facility' });
    });

    it('the gallery heading is the owner’s call: a staff login is refused, not silently dropped', async () => {
      const { updateBusiness } = await import('../../src/modules/business/business.service');
      await expect(updateBusiness('b1', { galleryHeading: 'Our Work' }, { isOwner: false })).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
      // A staff save from an old app build still carries the highlight fields: ignored, not refused.
      await expect(updateBusiness('b1', { name: 'Curv', statValue: '30k+' }, { isOwner: false })).resolves.toBeTruthy();
    });
  });

  describe('public microsite payload', () => {
    it('carries the gallery heading and the city; no longer the highlight fields', async () => {
      const { getMicrosite } = await import('../../src/modules/public/public.service');
      const site: any = await getMicrosite('curv');
      expect(site.galleryHeading).toBe('Inside the shop');
      expect(site.city).toBe('Naples');
      expect(site.area).toBeNull();
      expect(site).not.toHaveProperty('statValue');
      expect(site).not.toHaveProperty('statLabel');
    });

    it('a store with no heading gets null, so the page uses its default for that kind of store', async () => {
      one.mockImplementation(async () => ({ ...ROW, gallery_heading: null }));
      const { getMicrosite } = await import('../../src/modules/public/public.service');
      expect(((await getMicrosite('curv')) as any).galleryHeading).toBeNull();
    });

    it('the vCard’s locality is the city, even with no neighborhood', async () => {
      const { getVCard } = await import('../../src/modules/public/public.service');
      const card = await getVCard('curv');
      expect(card).toContain('ADR;TYPE=WORK:;;1 Main St;Naples;;;');
    });
  });
});
