/**
 * Migration runner — the ONLY place a direct pg connection is used (DDL cannot
 * run over PostgREST). Applies db/migrations/*.sql in filename order and records
 * them in schema_migrations. Idempotent: already-applied files are skipped.
 *
 *   npm run migrate
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected to Postgres.');

  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await client.query('select filename from schema_migrations')).rows.map(
      (r: { filename: string }) => r.filename,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`↷ skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`→ applying ${file} …`);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(filename) values ($1)', [file]);
      await client.query('commit');
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      console.error(`✗ failed ${file}:`, err);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('All migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
