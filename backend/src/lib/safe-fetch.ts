import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * A GET for a URL an admin typed in — i.e. attacker-influenced input — so it is an SSRF surface.
 * Nothing else in the backend fetches a caller-supplied URL (every other `fetch` goes to a fixed
 * provider host), so this guard is new and is the part of "autofill from a link" that must be right.
 *
 * What it enforces, and why each one is here:
 *  - http/https only, no embedded credentials, ports 80/443 only — stops `file:`/`gopher:` and
 *    port-scanning internal services by URL.
 *  - Every resolved address is checked against private / loopback / link-local / metadata ranges.
 *    The check runs INSIDE the socket's `lookup`, so the address that was validated is the address
 *    that is connected to. Resolving first and then handing the hostname to `fetch` would let a
 *    DNS-rebinding host answer "public" to the check and "127.0.0.1" to the connection.
 *  - IP-literal hosts never reach `lookup` (Node skips DNS for them), so they are checked up front.
 *    `new URL()` has already normalised `2130706433` / `0x7f.1` style tricks to dotted form by then.
 *  - Redirects are followed by hand (max 3) and every hop goes back through all of the above, so a
 *    public page cannot 302 the server onto an internal address.
 *  - Hard caps on time (10s total) and size (1.5 MB), text-ish content types only, and
 *    `accept-encoding: identity` so a compression bomb cannot expand past the cap.
 */
export type SafeFetchErrorCode =
  | 'BAD_URL'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_TYPE'
  | 'HTTP_ERROR'
  | 'NETWORK'
  | 'TOO_MANY_REDIRECTS';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export const SAFE_FETCH_MAX_BYTES = 1_500_000;
export const SAFE_FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const ACCEPTED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/ld+json'];

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

/** [network, prefix length] pairs that are never a legitimate public website. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 cloud metadata endpoint
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // unparseable ⇒ never trust it
  return BLOCKED_V4.some(([base, bits]) => {
    const b = v4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/** Expand any IPv6 text form (incl. `::` and a trailing dotted quad) to eight 16-bit groups. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  // A trailing dotted quad (`::ffff:1.2.3.4`) is two groups.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = v4ToInt(tail);
    if (n === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (allZeroTo(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d): judge the v4.
  if (allZeroTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedV4(`${g[6]! >>> 8}.${g[6]! & 255}.${g[7]! >>> 8}.${g[7]! & 255}`);
  }
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4 embeds an arbitrary v4 — not worth judging
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true; // NAT64 embeds an arbitrary v4
  return false;
}

/** True for any address the server must never connect to on an admin's say-so. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (net.isIPv4(bare)) return isBlockedV4(bare);
  if (net.isIPv6(bare)) return isBlockedV6(bare);
  return true;
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type ResolveFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Injectable so tests need no network. */
  resolve?: ResolveFn;
  /** Tests only — routes never pass these. They exist so a loopback fixture server is reachable. */
  isBlocked?: (ip: string) => boolean;
  allowedPorts?: number[];
}

export interface SafeFetchResult {
  /** After redirects — this, not the URL the admin typed, is the page that was read. */
  finalUrl: string;
  contentType: string;
  body: string;
}

const defaultResolve: ResolveFn = async (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

/** Parse + statically validate. Throws SafeFetchError('BAD_URL' | 'BLOCKED'). */
export function parseTarget(raw: string, opts: Pick<SafeFetchOptions, 'isBlocked' | 'allowedPorts'> = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SafeFetchError('BAD_URL', 'That does not look like a valid link');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('BAD_URL', 'Only http and https links are supported');
  }
  if (url.username || url.password) throw new SafeFetchError('BAD_URL', 'Links with a username or password are not supported');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!(opts.allowedPorts ?? [80, 443]).includes(port)) {
    throw new SafeFetchError('BLOCKED', 'That link points somewhere we cannot read');
  }
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new SafeFetchError('BLOCKED', 'That link points somewhere we cannot read');
  }
  if (net.isIP(host) && (opts.isBlocked ?? isBlockedIp)(host)) {
    throw new SafeFetchError('BLOCKED', 'That link points somewhere we cannot read');
  }
  return url;
}

function charsetOf(contentType: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  return m ? m[1]!.toLowerCase() : 'utf-8';
}

function decode(buf: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

interface Hop {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(url: URL, opts: Required<Pick<SafeFetchOptions, 'maxBytes' | 'resolve' | 'isBlocked'>>, deadline: number): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError('TIMEOUT', 'The site took too long to respond'));

    const lookup = (hostname: string, options: any, cb: (...a: any[]) => void) => {
      opts.resolve(hostname).then(
        (addrs) => {
          if (!addrs.length || addrs.some((a) => opts.isBlocked(a.address))) {
            return cb(new SafeFetchError('BLOCKED', 'That link points somewhere we cannot read'));
          }
          if (options?.all) cb(null, addrs);
          else cb(null, addrs[0]!.address, addrs[0]!.family);
        },
        (err) => cb(err),
      );
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: lookup as any,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-encoding': 'identity',
          'accept-language': 'en',
          'user-agent': 'Mozilla/5.0 (compatible; TejoTimeBot/1.0; +https://tejotime.com)',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // A redirect carries no page we want — don't read its body.
        if (status >= 300 && status < 400) {
          res.resume();
          clearTimeout(timer);
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const type = String(res.headers['content-type'] ?? '').toLowerCase();
        if (status >= 200 && status < 300 && type && !ACCEPTED_TYPES.some((t) => type.includes(t))) {
          res.destroy();
          clearTimeout(timer);
          return reject(new SafeFetchError('BAD_TYPE', 'That link is not a web page'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            clearTimeout(timer);
            return reject(new SafeFetchError('TOO_LARGE', 'That page is too large to read'));
          }
          chunks.push(c);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err instanceof SafeFetchError ? err : new SafeFetchError('NETWORK', 'Could not read that page'));
        });
      },
    );
    // One timer covers connect + headers + body, so a slow-drip server cannot hold the request open.
    const timer = setTimeout(() => {
      req.destroy();
      reject(new SafeFetchError('TIMEOUT', 'The site took too long to respond'));
    }, remaining);
    req.on('error', (err: any) => {
      clearTimeout(timer);
      // The lookup's own BLOCKED error surfaces here; keep its code, hide everything else.
      reject(err instanceof SafeFetchError ? err : new SafeFetchError('NETWORK', 'Could not reach that site'));
    });
    req.end();
  });
}

export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = {
    maxBytes: options.maxBytes ?? SAFE_FETCH_MAX_BYTES,
    resolve: options.resolve ?? defaultResolve,
    isBlocked: options.isBlocked ?? isBlockedIp,
  };
  const deadline = Date.now() + (options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  const targetOpts = { isBlocked: opts.isBlocked, allowedPorts: options.allowedPorts };

  let url = parseTarget(rawUrl, targetOpts);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, opts, deadline);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) throw new SafeFetchError('HTTP_ERROR', 'That link redirected without saying where');
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        throw new SafeFetchError('BAD_URL', 'That link redirected to an invalid address');
      }
      url = parseTarget(next, targetOpts);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SafeFetchError('HTTP_ERROR', `The site answered with an error (${res.status})`);
    }
    const contentType = String(res.headers['content-type'] ?? 'text/html');
    return { finalUrl: url.toString(), contentType, body: decode(res.body, contentType) };
  }
  throw new SafeFetchError('TOO_MANY_REDIRECTS', 'That link redirected too many times');
}
