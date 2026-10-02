import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may see and set commission. The rule this whole feature depends on: a staff login can be
 * SHOWN its own earnings (hidden unless an owner grants it) but can never set a pay rate — not
 * through the permission editor, not through a stale row, not by any route.
 * No DB: the pool is stubbed.
 */

const { one, many, exec } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => [] as unknown[]),
  exec: vi.fn(async () => 1),
}));

vi.mock('../../src/db/pool', () => ({
  exec,
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

const TEST_ENV = {
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

const STAFF_USER = '7d1e4c4e-1a7b-4d65-9f3c-2b8a1f0e9c11';

describe('commission permissions', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    many.mockImplementation(async () => []);
    exec.mockReset();
    exec.mockImplementation(async () => 1);
    process.env = { ...originalEnv, ...TEST_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('effective access', () => {
    it('hides earnings from a staff login by default, and shows them once granted', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('staff').commission).toBe('none');
      expect(effectiveAccess('staff', { commission: 'view' }).commission).toBe('view');
    });

    it('clamps a stale or hand-written "manage" row for a staff login down to view', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('staff', { commission: 'manage' }).commission).toBe('view');
      expect(effectiveAccess('manager', { commission: 'manage' }).commission).toBe('view');
    });

    it('gives the legacy manager the report but not the rates, and owners everything', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('manager').commission).toBe('view');
      expect(effectiveAccess('owner').commission).toBe('manage');
      expect(effectiveAccess('co_owner', { commission: 'none' }).commission).toBe('manage'); // owners ignore overrides
    });

    it('offers only none/view for commission in the editor, and the full range elsewhere', async () => {
      const { grantLevels } = await import('../../src/domain/permissions');
      expect(grantLevels('commission')).toEqual(['none', 'view']);
      expect(grantLevels('queue')).toEqual(['none', 'view', 'manage']);
    });
  });

  describe('the permission editor (users API)', () => {
    async function app() {
      const { usersRouter } = await import('../../src/modules/users/users.routes');
      const { errorHandler } = await import('../../src/middleware/error-handler');
      const { requestId } = await import('../../src/middleware/request-id');
      const a = express();
      a.use(express.json());
      a.use(requestId);
      a.use('/api/v1/users', usersRouter);
      a.use(errorHandler);
      return a;
    }

    async function ownerToken() {
      const { signAccessToken } = await import('../../src/modules/auth/token.service');
      return signAccessToken({ userId: 'owner-1', businessId: 'b1', role: 'owner' as any, plan: 'free' as any, staffId: null });
    }

    /** The staff login being edited, as SELECT_USER returns it. */
    function staffTarget() {
      one.mockImplementation(async (sql: string) =>
        /from app_user/.test(sql)
          ? { id: STAFF_USER, name: 'Lisa', phone: '919000000001', role: 'staff', is_super_owner: false, is_active: true, staff_id: 'st1', staff_name: 'Lisa', created_at: '2026-01-01' }
          : null,
      );
    }

    const fullMap = (commission: string) => ({
      dashboard: 'view',
      commission,
      queue: 'manage',
      appointments: 'view',
      calendar: 'view',
      customers: 'none',
      services: 'none',
      staff: 'none',
      hours: 'none',
      notifications: 'view',
      billing: 'none',
      profile: 'none',
    });

    it('refuses to give a staff login "manage" on commission — it could set its own pay', async () => {
      staffTarget();
      const res = await request(await app())
        .put(`/api/v1/users/${STAFF_USER}/permissions`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ permissions: fullMap('manage') });

      expect(res.status).toBe(400);
      expect(res.body.error.details?.[0]?.field).toBe('permissions.commission');
      expect(exec).not.toHaveBeenCalled();
    });

    it('lets the owner show a stylist their earnings (view)', async () => {
      staffTarget();
      const res = await request(await app())
        .put(`/api/v1/users/${STAFF_USER}/permissions`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ permissions: fullMap('view') });

      expect(res.status).toBe(200);
      const insert = exec.mock.calls.find((c) => /insert into user_permission/.test(c[0] as string));
      expect(insert?.[1]).toEqual(expect.arrayContaining(['commission', 'view']));
    });

    it('replaces only the modules sent, so an older app build cannot wipe a commission grant', async () => {
      staffTarget();
      const res = await request(await app())
        .put(`/api/v1/users/${STAFF_USER}/permissions`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ permissions: { dashboard: 'view', queue: 'manage' } }); // a map from before `commission`

      expect(res.status).toBe(200);
      const del = exec.mock.calls.find((c) => /delete from user_permission/.test(c[0] as string))!;
      expect(del[0]).toMatch(/module = any\(\$2::text\[\]\)/);
      expect(del[1]).toEqual([STAFF_USER, ['dashboard', 'queue']]);
    });

    it('serves the levels the grid may offer, and staff default to hidden', async () => {
      const res = await request(await app())
        .get('/api/v1/users/modules')
        .set('authorization', `Bearer ${await ownerToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.modules).toContainEqual({ key: 'commission', label: 'Commission & earnings', levels: ['none', 'view'] });
      expect(res.body.defaults.staff.commission).toBe('none');
    });
  });
});
