/**
 * Seed the "Sharp Cuts" demo tenant — ported from app/src/data/sample.ts and
 * frontend/src/app/sharp-cuts/page.tsx so both client apps light up immediately.
 * Idempotent: deletes and recreates the slug 'sharp-cuts'.
 *
 *   npm run seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { pgSsl } from '../src/db/ssl';
import { parsePriceToPaise } from '../src/domain/money';
import { dayjs } from '../src/lib/time';

const TZ = 'Asia/Kolkata';
const OWNER_HANDLE = 'sharpcuts';
const OWNER_PHONE = '919399385943'; // login credential — digits-only full number (country code + national)
const OWNER_PASSWORD = 'password123';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const DATABASE_URL: string = process.env.DATABASE_URL;

function at(time: string) {
  // e.g. "12:30 PM" today in IST → UTC ISO
  return dayjs.tz(`${dayjs().tz(TZ).format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD h:mm A', TZ).utc().toISOString();
}

/** Fail loudly when a statement that must have produced a row produced none. */
function must<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row == null) throw new Error(`Expected a row back from ${what} but got none`);
  return row;
}

/**
 * Insert one or more rows with $n placeholders (never string interpolation) and
 * return the inserted rows. Columns are the union of the rows' keys, so rows
 * that omit an optional field (e.g. started_at) simply insert null there.
 */
async function insertRows(client: Client, table: string, rows: Record<string, unknown>[]): Promise<any[]> {
  if (rows.length === 0) return [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const params: unknown[] = [];
  const tuples = rows.map((r) => `(${cols.map((c) => `$${params.push(r[c] ?? null)}`).join(', ')})`);
  const sql = `insert into ${table} (${cols.join(', ')}) values ${tuples.join(', ')} returning *`;
  const { rows: inserted } = await client.query(sql, params);
  return inserted;
}

async function main() {
  console.log('Seeding Sharp Cuts …');

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: pgSsl(DATABASE_URL),
  });
  await client.connect();

  try {
    // One transaction for the whole tenant — a partial failure leaves nothing behind.
    await client.query('begin');

    // Clean slate (cascade removes all children).
    await client.query('delete from business where slug = $1', ['sharp-cuts']);

    const business = must(
      await insertRows(client, 'business', [
        {
          slug: 'sharp-cuts',
          country_code: '91',
          phone_number: '9399385943',
          name: 'Sharp Cuts',
          category: 'Salon & Barber',
          area: 'Andheri West',
          address: 'Shop 4, Linking Road, Bandra West, Mumbai',
          city: 'Mumbai',
          tagline: "Bandra's neighbourhood barber",
          description:
            "Since 2014, Sharp Cuts has been Bandra's go-to for classic and modern cuts. Skilled barbers, clean chairs, and a live queue so you never waste time waiting around.",
          established_year: 2014,
          rating: 4.9,
          review_count: 212,
          timezone: TZ,
          currency: 'INR',
          token_prefix: 'A',
        },
      ]),
      'business',
    );
    const bid = business.id as string;

    must(await insertRows(client, 'subscription', [{ business_id: bid, plan: 'free', status: 'trialing' }]), 'subscription');

    // Owner login (phone + password) — matches app/src/app/(auth)/login.tsx.
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD + (process.env.PASSWORD_PEPPER ?? ''), 10);
    must(
      await insertRows(client, 'app_user', [
        { business_id: bid, handle: OWNER_HANDLE, phone: OWNER_PHONE, name: 'Sharp Cuts Owner', role: 'owner', password_hash: passwordHash },
      ]),
      'app_user',
    );

    // Working hours (Sun closed, Mon–Fri 10–20, Sat 9–21).
    const hours = [
      { day_of_week: 0, opens_at: null, closes_at: null, is_closed: true },
      ...[1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, opens_at: '10:00', closes_at: '20:00', is_closed: false })),
      { day_of_week: 6, opens_at: '09:00', closes_at: '21:00', is_closed: false },
    ].map((h) => ({ business_id: bid, ...h }));
    await insertRows(client, 'business_hour', hours);

    await insertRows(
      client,
      'amenity',
      ['Air conditioned', 'UPI · Card · Cash', 'Parking', 'Free wifi', 'Kids friendly', 'Wheelchair access'].map(
        (label, position) => ({ business_id: bid, label, position }),
      ),
    );

    // Services (owner-app canonical list — docs/17 Q29).
    const serviceRows = [
      { name: 'Haircut', duration_minutes: 30, price_paise: parsePriceToPaise('₹350'), color_token: 'secondary' },
      { name: 'Haircut & Beard', duration_minutes: 45, price_paise: parsePriceToPaise('₹450'), color_token: 'primary' },
      { name: 'Hair Color', duration_minutes: 90, price_paise: parsePriceToPaise('₹1,200'), color_token: 'amber500' },
      { name: 'Hair Spa', duration_minutes: 60, price_paise: parsePriceToPaise('₹800'), color_token: 'green500' },
    ].map((s, position) => ({ business_id: bid, position, ...s }));
    const services = await insertRows(client, 'service', serviceRows);
    const svc = (name: string) => services.find((s: any) => s.name === name)?.id ?? null;

    // Staff / seats.
    const staffRows = [
      { name: 'John', role_label: 'Master barber', color_token: 'primary' },
      { name: 'Lisa', role_label: 'Stylist · color', color_token: 'secondary' },
      { name: 'Mike', role_label: 'Barber', color_token: 'amber500' },
    ].map((s, position) => ({ business_id: bid, position, ...s }));
    const staff = await insertRows(client, 'staff', staffRows);
    const seat = (name: string) => staff.find((s: any) => s.name === name)?.id as string;

    // Customers.
    const customerRows = [
      { name: 'Rahul Mehta', phone: '+919820112345', is_vip: true, visits_count: 14, total_spend_paise: parsePriceToPaise('₹6.2k'), last_visit_at: dayjs().subtract(3, 'day').toISOString() },
      { name: 'Aisha Khan', phone: '+919930155512', is_vip: false, visits_count: 9, total_spend_paise: parsePriceToPaise('₹4.1k'), last_visit_at: dayjs().toISOString() },
      { name: 'Neha Gupta', phone: '+919004087654', is_vip: true, visits_count: 22, total_spend_paise: parsePriceToPaise('₹12.8k'), last_visit_at: dayjs().subtract(7, 'day').toISOString() },
      { name: 'Vivek Rao', phone: '+919123400099', is_vip: false, visits_count: 3, total_spend_paise: parsePriceToPaise('₹1.4k'), last_visit_at: dayjs().subtract(14, 'day').toISOString() },
    ].map((c) => ({ business_id: bid, ...c }));
    await insertRows(client, 'customer', customerRows);

    // Live queue (positions maintained among a seat's waiting entries).
    const today = dayjs().tz(TZ).format('YYYYMMDD');
    const queueRows = [
      { customer_name: 'Aisha Khan', service_name: 'Haircut & Beard', service_id: svc('Haircut & Beard'), staff_id: seat('John'), status: 'in_service', source: 'walk_in', position: 0, token: 'A-1', started_at: dayjs().subtract(15, 'minute').toISOString() },
      { customer_name: 'Rahul Mehta', service_name: 'Hair Color', service_id: svc('Hair Color'), staff_id: seat('John'), status: 'waiting', source: 'online', position: 0, token: 'A-2' },
      { customer_name: 'Sana Iqbal', service_name: 'Haircut', service_id: svc('Haircut'), staff_id: seat('John'), status: 'waiting', source: 'online', position: 1, token: 'A-3' },
      { customer_name: 'Vivek Rao', service_name: 'Haircut', service_id: svc('Haircut'), staff_id: seat('Lisa'), status: 'in_service', source: 'online', position: 0, token: 'A-4', started_at: dayjs().subtract(10, 'minute').toISOString() },
      { customer_name: 'Imran Shah', service_name: 'Beard Trim', service_id: null, staff_id: seat('Lisa'), status: 'waiting', source: 'walk_in', position: 0, token: 'A-5' },
    ].map((r) => ({ business_id: bid, token_day: today, ...r }));
    await insertRows(client, 'queue_entry', queueRows);

    // Set the daily token counter past the seeded tokens so next_token continues at A-6.
    await client.query(
      `insert into token_counter (business_id, day_key, seq) values ($1, $2, $3)
         on conflict (business_id, day_key) do update set seq = excluded.seq`,
      [bid, today, 5],
    );

    // Today's appointments.
    const apptRows = [
      { customer_name: 'Neha Gupta', service_name: 'Keratin Treatment', service_id: null, status: 'confirmed', scheduled_start_at: at('12:30 PM') },
      { customer_name: 'Arjun Das', service_name: 'Haircut', service_id: svc('Haircut'), status: 'confirmed', scheduled_start_at: at('1:00 PM') },
      { customer_name: 'Priya Nair', service_name: 'Hair Spa', service_id: svc('Hair Spa'), status: 'pending', scheduled_start_at: at('2:15 PM') },
      { customer_name: 'Karan Bose', service_name: 'Haircut & Beard', service_id: svc('Haircut & Beard'), status: 'pending', scheduled_start_at: at('3:00 PM') },
    ].map((a) => ({ business_id: bid, source: 'online', ...a }));
    await insertRows(client, 'appointment', apptRows);

    await client.query('commit');

    console.log('✓ Seed complete.');
    console.log(`  business: ${business.name} (slug: sharp-cuts, id: ${bid})`);
    console.log(`  owner login → phone: ${OWNER_PHONE}  password: ${OWNER_PASSWORD}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
