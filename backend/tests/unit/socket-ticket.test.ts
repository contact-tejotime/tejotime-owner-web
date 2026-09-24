import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * POST /auth/socket-ticket through the real router and error handler — no database, no server.
 *
 * The ticket exists so owner-web (httpOnly access cookie) can open the `/owner` socket. What this
 * file proves is the containment: the ticket opens a socket and NOTHING else — it must never
 * pass `authenticate` as a REST bearer — and it is minted from the caller's token, never input.
 */

const ACCESS_SECRET = 'test-access-secret';
const PATH = '/api/v1/auth/socket-ticket';

// The first case pays for a cold import of the auth router (~3s alone); under the full parallel
// suite that brushed vitest's 5s default.
describe('socket ticket', { timeout: 20_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      S3_ENDPOINT: 'https://example.storageapi.dev',
      S3_ACCESS_KEY_ID: 'test-access-key-id',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      S3_BUCKET: 'test-bucket',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function app() {
    const { authRouter } = await import('../../src/modules/auth/auth.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/auth', authRouter);
    a.use(errorHandler);
    return a;
  }

  async function accessToken(role = 'owner', staffId: string | null = null) {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({ userId: 'u1', businessId: 'b1', role: role as any, plan: 'free' as any, staffId });
  }

  it('mints a 60s ticket carrying the caller’s business, role and seat', async () => {
    const res = await request(await app())
      .post(PATH)
      .set('authorization', `Bearer ${await accessToken('staff', 'seat-1')}`)
      .send({ businessId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(60);

    const { verifyOwnerSocketCredential } = await import('../../src/modules/auth/token.service');
    const claims = verifyOwnerSocketCredential(res.body.ticket) as any;
    expect(claims).toMatchObject({ typ: 'socket', sub: 'u1', bid: 'b1', role: 'staff', sid: 'seat-1' });
    expect(claims.exp - claims.iat).toBe(60);
  });

  it('requires a signed-in caller', async () => {
    const res = await request(await app()).post(PATH).send({});
    expect(res.status).toBe(401);
  });

  it('is refused as a REST bearer — a ticket cannot mint another ticket', async () => {
    const minted = await request(await app())
      .post(PATH)
      .set('authorization', `Bearer ${await accessToken()}`);
    const res = await request(await app())
      .post(PATH)
      .set('authorization', `Bearer ${minted.body.ticket}`);
    expect(res.status).toBe(401);
  });

  it('the socket verifier accepts access tokens and tickets, and nothing else', async () => {
    const { verifyOwnerSocketCredential, signAdminToken, signSocketTicket } = await import(
      '../../src/modules/auth/token.service'
    );
    expect(verifyOwnerSocketCredential(await accessToken()).typ).toBe('access');
    expect(verifyOwnerSocketCredential(signSocketTicket({ userId: 'u', businessId: 'b', role: 'owner' as any })).typ).toBe(
      'socket',
    );
    // Same secret as owner tokens, so only the typ check keeps an admin token off the owner socket.
    expect(() => verifyOwnerSocketCredential(signAdminToken('919999999999'))).toThrow();
    expect(() => verifyOwnerSocketCredential('not-a-jwt')).toThrow();
  });

  it('rejects an expired ticket', async () => {
    const { verifyOwnerSocketCredential } = await import('../../src/modules/auth/token.service');
    const stale = jwt.sign(
      { sub: 'u1', bid: 'b1', role: 'owner', typ: 'socket', exp: Math.floor(Date.now() / 1000) - 5 },
      ACCESS_SECRET,
    );
    expect(() => verifyOwnerSocketCredential(stale)).toThrow(/expired/);
  });
});
