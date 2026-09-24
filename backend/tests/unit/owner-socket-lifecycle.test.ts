import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `/owner` socket must stay usable for a whole working day — 15 minutes idle, 45, any time.
 *
 * A real http server running the real `initRealtime()`, driven by the real socket.io-client; no
 * database. What these pin down is the contract both clients (owner-web LiveRefresh, the mobile
 * store) are built on:
 *   - credentials are checked at the handshake only, so an OPEN connection outlives its token;
 *   - an ordinary drop is retried by Socket.IO and re-reads `auth`, so a getter hands in a fresh one;
 *   - a refused handshake or a server kick is NOT retried (`active === false`) — which is why
 *     both clients re-dial by hand. The mobile app used to pass a fixed token and die here.
 */

const SECRET = 'test-access-secret';
const BID = 'biz-live';

function token(opts: { typ?: 'access' | 'socket'; ttlSec?: number; expiredAgoSec?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expiredAgoSec ? now - opts.expiredAgoSec : now + (opts.ttlSec ?? 60);
  return jwt.sign({ sub: 'u1', bid: BID, role: 'owner', typ: opts.typ ?? 'socket', exp }, SECRET);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function once<T = unknown>(s: Socket, event: string, ms = 4000): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    s.once(event, (d: T) => {
      clearTimeout(t);
      resolve(d);
    });
  });
}

describe('/owner socket lifecycle', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };
  let http: HttpServer;
  let url: string;
  let emitToOwners: (bid: string, ev: string, p: unknown) => void;
  let serverNs: import('socket.io').Namespace;
  const clients: Socket[] = [];

  beforeEach(async () => {
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
      JWT_ACCESS_SECRET: SECRET,
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
    };
    const { initRealtime, getOwnerNs } = await import('../../src/realtime/io');
    ({ emitToOwners } = await import('../../src/realtime/emitters'));
    http = createServer();
    initRealtime(http);
    serverNs = getOwnerNs()!;
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/owner`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    serverNs.server.close();
    await new Promise((r) => http.close(() => r(null)));
    process.env = { ...originalEnv };
  });

  function connect(getToken: () => string) {
    let calls = 0;
    const s = ioClient(url, {
      transports: ['websocket'],
      reconnectionDelay: 100,
      reconnectionDelayMax: 200,
      auth: (cb) => {
        calls++;
        cb({ token: getToken() });
      },
    });
    clients.push(s);
    return { s, authCalls: () => calls };
  }

  it('an open connection outlives its ticket and keeps receiving queue updates', async () => {
    const { s } = connect(() => token({ ttlSec: 2 }));
    expect(await once(s, 'connected')).not.toBeNull();
    await wait(3500); // past the ticket's expiry
    expect(s.connected).toBe(true);
    const snap = once<{ seats: unknown[] }>(s, 'queue:snapshot');
    emitToOwners(BID, 'queue:snapshot', { seats: [{ id: 'a' }] });
    expect((await snap)?.seats).toHaveLength(1);
  });

  it('a dropped connection reconnects on its own, fetching a fresh credential', async () => {
    const { s, authCalls } = connect(() => token());
    await once(s, 'connected');
    const back = once(s, 'connected');
    for (const sock of serverNs.sockets.values()) sock.conn.close(); // network blip / proxy cut
    expect(await back).not.toBeNull();
    expect(authCalls()).toBe(2);
    const snap = once(s, 'queue:snapshot');
    emitToOwners(BID, 'queue:snapshot', { seats: [] });
    expect(await snap).not.toBeNull();
  });

  it('a reconnect with an expired token is refused and NOT retried — the old mobile failure', async () => {
    let expired = false;
    const { s } = connect(() => (expired ? token({ typ: 'access', expiredAgoSec: 30 }) : token({ typ: 'access' })));
    await once(s, 'connected');
    expired = true; // 15 minutes later, with the token captured at sign-in
    const err = once<Error>(s, 'connect_error');
    for (const sock of serverNs.sockets.values()) sock.conn.close();
    expect((await err)?.message).toBe('unauthorized');
    await wait(500);
    expect(s.connected).toBe(false);
    expect(s.active).toBe(false); // Socket.IO has given up — only a manual re-dial recovers

    // The fix: refresh, then re-dial by hand. The getter now returns a valid token.
    expired = false;
    const back = once(s, 'connected');
    s.connect();
    expect(await back).not.toBeNull();
  });

  it('a server kick is not retried automatically, and a manual re-dial recovers', async () => {
    const { s } = connect(() => token());
    await once(s, 'connected');
    const gone = once<string>(s, 'disconnect');
    for (const sock of serverNs.sockets.values()) sock.disconnect(true);
    expect(await gone).toBe('io server disconnect');
    expect(s.active).toBe(false);
    const back = once(s, 'connected');
    s.connect();
    expect(await back).not.toBeNull();
  });

  it('staff tickets never receive the whole-shop snapshot', async () => {
    const staff = jwt.sign({ sub: 'u2', bid: BID, role: 'staff', sid: 'seat-1', typ: 'socket' }, SECRET, {
      expiresIn: 60,
    });
    const { s } = connect(() => staff);
    await once(s, 'connected');
    const snap = once(s, 'queue:snapshot', 800);
    emitToOwners(BID, 'queue:snapshot', { seats: [] });
    expect(await snap).toBeNull();
  });
});
