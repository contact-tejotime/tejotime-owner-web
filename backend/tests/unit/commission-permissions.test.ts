import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may see and set commission. The rule this whole feature depends on: every staff login sees
 * its own earnings — by role, not by a grant, so no owner toggle hides them — and can never set a
 * pay rate: not through the permission editor, not through a stale row, not by any route.
 * No DB: the pool is stubbed.
 */

const { one, many, exec } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => [] as unknown[]),
  exec: vi.fn(async (_sql: string, _params?: unknown[]) => 1),
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
    it('shows every staff login its own earnings by default', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('staff').commission).toBe('view');
    });

    it('ignores commission rows saved while it was a toggle — "Hidden" does not hide, "manage" does not raise', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('staff', { commission: 'none' }).commission).toBe('view');
      expect(effectiveAccess('staff', { commission: 'manage' }).commission).toBe('view');
      expect(effectiveAccess('manager', { commission: 'manage' }).commission).toBe('view');
    });

    it('still applies overrides to the modules an owner can grant', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('staff', { customers: 'view', dashboard: 'none' })).toMatchObject({
        customers: 'view',
        dashboard: 'none',
        commission: 'view',
      });
    });

    it('gives the legacy manager the report but not the rates, and owners everything', async () => {
      const { effectiveAccess } = await import('../../src/domain/permissions');
      expect(effectiveAccess('manager').commission).toBe('view');
      expect(effectiveAccess('owner').commission).toBe('manage');
      expect(effectiveAccess('co_owner', { commission: 'none' }).commission).toBe('manage'); // owners ignore overrides
    });

    it('is not something an owner grants — like team, it is decided by the role', async () => {
      const { GRANTABLE_MODULES, MODULES } = await import('../../src/domain/permissions');
      expect(MODULES).toContain('commission'); // still in /auth/me, so the clients can draw it
      expect(GRANTABLE_MODULES).not.toContain('commission');
      expect(GRANTABLE_MODULES).not.toContain('team');
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

    /** The complete map an app build from while earnings were a toggle still sends on every save. */
    const oldAppMap = (commission: string) => ({
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

    for (const commission of ['none', 'view', 'manage']) {
      it(`accepts an old app's save carrying commission: ${commission}, and stores nothing for it`, async () => {
        staffTarget();
        const res = await request(await app())
          .put(`/api/v1/users/${STAFF_USER}/permissions`)
          .set('authorization', `Bearer ${await ownerToken()}`)
          .send({ permissions: oldAppMap(commission) });

        expect(res.status).toBe(200);
        const del = exec.mock.calls.find((c) => /delete from user_permission/.test(c[0]))!;
        expect(del[1]![1]).not.toContain('commission');
        const insert = exec.mock.calls.find((c) => /insert into user_permission/.test(c[0]))!;
        expect(insert[1]).not.toContain('commission');
        expect(insert[1]).toEqual(expect.arrayContaining(['queue', 'manage']));
      });
    }

    it('still refuses a module that never existed', async () => {
      staffTarget();
      const res = await request(await app())
        .put(`/api/v1/users/${STAFF_USER}/permissions`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ permissions: { dashboard: 'view', payroll: 'view' } });

      expect(res.status).toBe(400);
      expect(exec).not.toHaveBeenCalled();
    });

    it("lets an old app's create form through validation too (the create body shares the schema)", async () => {
      // Only validation is under test: the service behind it is not stubbed, so the request is
      // judged by whether the 400 it may still get names a permission field.
      const create = async (permissions: Record<string, string>) =>
        request(await app())
          .post('/api/v1/users')
          .set('authorization', `Bearer ${await ownerToken()}`)
          .send({ name: 'Lisa', phone: '919000000001', password: 'longenough', role: 'staff', staffId: STAFF_USER, permissions });
      const permissionFields = (res: request.Response) =>
        ((res.body.error?.details ?? []) as { field: string }[]).filter((d) => d.field.startsWith('permissions'));

      expect(permissionFields(await create(oldAppMap('none')))).toEqual([]);
      // …and the check is real: an unknown module IS named.
      expect(permissionFields(await create({ dashboard: 'view', payroll: 'view' })).length).toBeGreaterThan(0);
    });

    it('replaces only the modules sent, so an older app build cannot wipe a grant it does not know', async () => {
      staffTarget();
      const res = await request(await app())
        .put(`/api/v1/users/${STAFF_USER}/permissions`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ permissions: { dashboard: 'view', queue: 'manage' } });

      expect(res.status).toBe(200);
      const del = exec.mock.calls.find((c) => /delete from user_permission/.test(c[0]))!;
      expect(del[0]).toMatch(/module = any\(\$2::text\[\]\)/);
      expect(del[1]).toEqual([STAFF_USER, ['dashboard', 'queue']]);
    });

    it('does not offer commission in the grid', async () => {
      const res = await request(await app())
        .get('/api/v1/users/modules')
        .set('authorization', `Bearer ${await ownerToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.modules.map((m: { key: string }) => m.key)).not.toContain('commission');
      expect(res.body.modules).toContainEqual({ key: 'queue', label: 'Queue' });
      expect(res.body.defaults.staff).not.toHaveProperty('commission');
    });
  });
});
