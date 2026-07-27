import type { ConnectionOptions } from 'node:tls';

/**
 * Decide the TLS settings for a Postgres connection string.
 *
 * Standalone (no `config/env` import) so the migration/seed CLIs can share it
 * without pulling in the full runtime env schema.
 *
 * Railway exposes Postgres two ways and they differ: the private network
 * hostname (`*.railway.internal`) does NOT terminate TLS, while the public TCP
 * proxy (`*.proxy.rlwy.net`) does, with a certificate we can't verify against a
 * public CA. Passing `ssl` unconditionally breaks the former; omitting it
 * breaks the latter.
 */
export function pgSsl(connectionString: string): ConnectionOptions | false {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL (e.g. a key=value DSN) — let pg apply its own defaults.
    return false;
  }

  // Explicit intent in the connection string always wins.
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'disable') return false;
  if (sslmode) return { rejectUnauthorized: sslmode === 'verify-full' };

  const host = url.hostname;
  if (host.endsWith('.railway.internal') || host === 'localhost' || host === '127.0.0.1') {
    return false;
  }
  return { rejectUnauthorized: false };
}
