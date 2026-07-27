import { Pool, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { pgSsl } from './ssl';

/**
 * The single data-access entry point at runtime (no ORM) — a plain `pg` pool.
 * Every query MUST scope by business_id explicitly: tenant isolation is enforced
 * in the service layer, not by row-level security.
 *
 * DDL/migrations are handled separately by db/migrate.ts, which opens its own
 * one-shot connection rather than borrowing from this pool.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: pgSsl(env.DATABASE_URL),
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An error on an *idle* client is emitted here rather than at a call site; without
// a listener Node treats it as unhandled and kills the process.
pool.on('error', (err) => {
  logger.error({ err }, 'Idle Postgres client error');
});

/** Run a query and return all rows. */
export async function many<T extends QueryResultRow = any>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params as unknown[]);
  return rows;
}

/** Run a query and return the first row, or null when there is none. */
export async function one<T extends QueryResultRow = any>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const { rows } = await pool.query<T>(sql, params as unknown[]);
  return rows[0] ?? null;
}

/** Run a statement for its side effect and return the number of rows affected. */
export async function exec(sql: string, params: readonly unknown[] = []): Promise<number> {
  const { rowCount } = await pool.query(sql, params as unknown[]);
  return rowCount ?? 0;
}

/** Run `fn` inside a transaction on a single dedicated connection. */
export async function transaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
