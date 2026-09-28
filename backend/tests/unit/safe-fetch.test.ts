import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedIp, parseTarget, safeFetchText, SafeFetchError } from '../../src/lib/safe-fetch';

/**
 * The SSRF guard behind "autofill store from a link". Pure functions + a throwaway loopback server
 * (reachable only because these tests pass the test-only `isBlocked`/`allowedPorts` overrides —
 * the default guard refuses loopback, which the first block proves). No DB, no external network.
 */

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::',
    'not-an-ip', '',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe('parseTarget', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as SafeFetchError).code;
    }
    return null;
  };

  it('accepts an ordinary https/http link', () => {
    expect(parseTarget('https://example.com/salon').hostname).toBe('example.com');
    expect(parseTarget('  http://example.com  ').protocol).toBe('http:');
  });

  it.each([
    ['not a url', 'BAD_URL'],
    ['file:///etc/passwd', 'BAD_URL'],
    ['ftp://example.com/x', 'BAD_URL'],
    ['javascript:alert(1)', 'BAD_URL'],
    ['https://user:pw@example.com/', 'BAD_URL'],
    ['https://example.com:8080/', 'BLOCKED'],
    ['https://example.com:22/', 'BLOCKED'],
    ['http://localhost/', 'BLOCKED'],
    ['http://foo.localhost/', 'BLOCKED'],
    ['http://printer.local/', 'BLOCKED'],
    ['http://metadata.internal/', 'BLOCKED'],
    ['http://127.0.0.1/', 'BLOCKED'],
    ['http://169.254.169.254/latest/meta-data/', 'BLOCKED'],
    ['http://[::1]/', 'BLOCKED'],
    ['http://[::ffff:127.0.0.1]/', 'BLOCKED'],
    ['http://10.1.2.3/', 'BLOCKED'],
    // Integer / hex / octal spellings of 127.0.0.1 — WHATWG URL normalises them to dotted form first.
    ['http://2130706433/', 'BLOCKED'],
    ['http://0x7f.0.0.1/', 'BLOCKED'],
    ['http://0177.0.0.1/', 'BLOCKED'],
  ])('rejects %s (%s)', (raw, expected) => {
    expect(code(() => parseTarget(raw))).toBe(expected);
  });
});

describe('safeFetchText', () => {
  let server: http.Server;
  let port: number;
  let base: string;
  const open = { isBlocked: () => false };
  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
    '/ok': (_q, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><title>Hello</title></html>');
    },
    '/latin1': (_q, res) => {
      res.setHeader('content-type', 'text/html; charset=iso-8859-1');
      res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    },
    '/json': (_q, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    },
    '/big': (_q, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('x'.repeat(5_000));
    },
    '/500': (_q, res) => {
      res.statusCode = 500;
      res.end('boom');
    },
    '/slow': () => {
      /* never answers */
    },
    '/hop1': (_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', '/hop2');
      res.end();
    },
    '/hop2': (_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', '/ok');
      res.end();
    },
    '/loop': (_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      res.end();
    },
    '/to-metadata': (_q, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
      res.end();
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const handler = routes[req.url ?? ''];
      if (handler) return handler(req, res);
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const opts = (extra: object = {}) => ({ ...open, allowedPorts: [port], ...extra });
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as SafeFetchError;
    }
    return null;
  };

  it('by default refuses the same loopback server (the guard is on unless a test opts out)', async () => {
    const err = await failure(safeFetchText(`${base}/ok`));
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err!.code).toBe('BLOCKED');
  });

  it('reads a page and reports the final URL', async () => {
    const res = await safeFetchText(`${base}/ok`, opts());
    expect(res.body).toContain('<title>Hello</title>');
    expect(res.finalUrl).toBe(`${base}/ok`);
  });

  it('honours the declared charset', async () => {
    expect((await safeFetchText(`${base}/latin1`, opts())).body).toBe('café');
  });

  it('follows redirects, reporting where it ended up', async () => {
    const res = await safeFetchText(`${base}/hop1`, opts());
    expect(res.finalUrl).toBe(`${base}/ok`);
  });

  it('gives up on a redirect loop', async () => {
    expect((await failure(safeFetchText(`${base}/loop`, opts())))!.code).toBe('TOO_MANY_REDIRECTS');
  });

  it('re-validates every hop: a public page cannot redirect onto the metadata address', async () => {
    // Only the guard on the SECOND hop can stop this — the first target is reachable.
    const guardAllowsOnlyLoopback = { isBlocked: (ip: string) => ip !== '127.0.0.1', allowedPorts: [port, 80] };
    const err = await failure(safeFetchText(`${base}/to-metadata`, guardAllowsOnlyLoopback));
    expect(err!.code).toBe('BLOCKED');
  });

  it('blocks a hostname that RESOLVES to a private address (DNS rebinding / internal name)', async () => {
    const err = await failure(
      safeFetchText(`http://evil.example.com/ok`, {
        resolve: async () => [{ address: '10.0.0.7', family: 4 }],
      }),
    );
    expect(err!.code).toBe('BLOCKED');
  });

  it('blocks when ANY resolved address is private, not just the first', async () => {
    const err = await failure(
      safeFetchText(`http://mixed.example.com/ok`, {
        resolve: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
    );
    expect(err!.code).toBe('BLOCKED');
  });

  it('rejects a non-page content type', async () => {
    expect((await failure(safeFetchText(`${base}/json`, opts())))!.code).toBe('BAD_TYPE');
  });

  it('rejects a body over the size cap', async () => {
    expect((await failure(safeFetchText(`${base}/big`, opts({ maxBytes: 1_000 }))))!.code).toBe('TOO_LARGE');
  });

  it('surfaces an HTTP error status', async () => {
    expect((await failure(safeFetchText(`${base}/500`, opts())))!.code).toBe('HTTP_ERROR');
  });

  it('times out a server that never answers', async () => {
    expect((await failure(safeFetchText(`${base}/slow`, opts({ timeoutMs: 300 }))))!.code).toBe('TIMEOUT');
  });
});
