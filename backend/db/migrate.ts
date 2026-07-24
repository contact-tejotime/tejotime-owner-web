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
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

// Admin login passwords live in the DB (admins.password_hash) and are peppered
// like owner logins, so the hash is computed here in JS (pepper is
// deployment-specific and can't live in a static .sql file). Any admin row
// still missing a hash gets the demo password — existing mobiles are left alone.
const DEMO_ADMIN_PASSWORD = 'admin456';

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

  // Ensure every admin row has a login password (bcrypt + pepper), mirroring how
  // owners are seeded. Idempotent: only fills null hashes, so a changed admin
  // password is never reset. Does not invent/change admin mobiles.
  const pepper = process.env.PASSWORD_PEPPER ?? '';
  const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD + pepper, 10);
  const res = await client.query(
    'update admins set password_hash = $1 where password_hash is null returning mobile',
    [adminHash],
  );
  if (res.rowCount) {
    console.log(
      `✓ set demo admin password (${DEMO_ADMIN_PASSWORD}) for: ${res.rows.map((r: { mobile: string }) => r.mobile).join(', ')}`,
    );
  }

  await client.end();
  console.log('All migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
