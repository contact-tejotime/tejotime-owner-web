/**
 * Seed the "Sharp Cuts" demo tenant — ported from app/src/data/sample.ts and
 * frontend/src/app/sharp-cuts/page.tsx so both client apps light up immediately.
 * Idempotent: deletes and recreates the slug 'sharp-cuts'.
 *
 *   npm run seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from '../src/db/supabase';
import { parsePriceToPaise } from '../src/domain/money';
import { dayjs } from '../src/lib/time';

const TZ = 'Asia/Kolkata';
const OWNER_HANDLE = 'sharpcuts';
const OWNER_PASSWORD = 'password123';

function at(time: string) {
  // e.g. "12:30 PM" today in IST → UTC ISO
  return dayjs.tz(`${dayjs().tz(TZ).format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD h:mm A', TZ).utc().toISOString();
}

async function must<T>(p: PromiseLike<{ data: T; error: any }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message ?? JSON.stringify(error));
  if (data == null) throw new Error('Expected data from Supabase but got null');
  return data as NonNullable<T>;
}

async function main() {
  console.log('Seeding Sharp Cuts …');

  // Clean slate (cascade removes all children).
  await supabase.from('business').delete().eq('slug', 'sharp-cuts');

  const business = await must(
    supabase
      .from('business')
      .insert({
        slug: 'sharp-cuts',
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
      })
      .select()
      .single(),
  );
  const bid = business.id as string;

  await must(
    supabase.from('subscription').insert({ business_id: bid, plan: 'free', status: 'trialing' }).select().single(),
  );

  // Owner login (User ID + password) — matches app/src/screens/Login.tsx.
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD + (process.env.PASSWORD_PEPPER ?? ''), 10);
  await must(
    supabase
      .from('app_user')
      .insert({ business_id: bid, handle: OWNER_HANDLE, name: 'Sharp Cuts Owner', role: 'owner', password_hash: passwordHash })
      .select()
      .single(),
  );

  // Working hours (Sun closed, Mon–Fri 10–20, Sat 9–21).
  const hours = [
    { day_of_week: 0, opens_at: null, closes_at: null, is_closed: true },
    ...[1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, opens_at: '10:00', closes_at: '20:00', is_closed: false })),
    { day_of_week: 6, opens_at: '09:00', closes_at: '21:00', is_closed: false },
  ].map((h) => ({ business_id: bid, ...h }));
  await must(supabase.from('business_hour').insert(hours).select());

  await must(
    supabase
      .from('amenity')
      .insert(
        ['Air conditioned', 'UPI · Card · Cash', 'Parking', 'Free wifi', 'Kids friendly', 'Wheelchair access'].map(
          (label, position) => ({ business_id: bid, label, position }),
        ),
      )
      .select(),
  );

  // Services (owner-app canonical list — docs/17 Q29).
  const serviceRows = [
    { name: 'Haircut', duration_minutes: 30, price_paise: parsePriceToPaise('₹350'), color_token: 'secondary' },
    { name: 'Haircut & Beard', duration_minutes: 45, price_paise: parsePriceToPaise('₹450'), color_token: 'primary' },
    { name: 'Hair Color', duration_minutes: 90, price_paise: parsePriceToPaise('₹1,200'), color_token: 'amber500' },
    { name: 'Hair Spa', duration_minutes: 60, price_paise: parsePriceToPaise('₹800'), color_token: 'green500' },
  ].map((s, position) => ({ business_id: bid, position, ...s }));
  const services = await must(supabase.from('service').insert(serviceRows).select());
  const svc = (name: string) => services.find((s: any) => s.name === name)?.id ?? null;

  // Staff / seats.
  const staffRows = [
    { name: 'John', role_label: 'Master barber', color_token: 'primary' },
    { name: 'Lisa', role_label: 'Stylist · color', color_token: 'secondary' },
    { name: 'Mike', role_label: 'Barber', color_token: 'amber500' },
  ].map((s, position) => ({ business_id: bid, position, ...s }));
  const staff = await must(supabase.from('staff').insert(staffRows).select());
  const seat = (name: string) => staff.find((s: any) => s.name === name)?.id as string;

  // Customers.
  const customerRows = [
    { name: 'Rahul Mehta', phone: '+919820112345', is_vip: true, visits_count: 14, total_spend_paise: parsePriceToPaise('₹6.2k'), last_visit_at: dayjs().subtract(3, 'day').toISOString() },
    { name: 'Aisha Khan', phone: '+919930155512', is_vip: false, visits_count: 9, total_spend_paise: parsePriceToPaise('₹4.1k'), last_visit_at: dayjs().toISOString() },
    { name: 'Neha Gupta', phone: '+919004087654', is_vip: true, visits_count: 22, total_spend_paise: parsePriceToPaise('₹12.8k'), last_visit_at: dayjs().subtract(7, 'day').toISOString() },
    { name: 'Vivek Rao', phone: '+919123400099', is_vip: false, visits_count: 3, total_spend_paise: parsePriceToPaise('₹1.4k'), last_visit_at: dayjs().subtract(14, 'day').toISOString() },
  ].map((c) => ({ business_id: bid, ...c }));
  await must(supabase.from('customer').insert(customerRows).select());

  // Live queue (positions maintained among a seat's waiting entries).
  const today = dayjs().tz(TZ).format('YYYYMMDD');
  const queueRows = [
    { customer_name: 'Aisha Khan', service_name: 'Haircut & Beard', service_id: svc('Haircut & Beard'), staff_id: seat('John'), status: 'in_service', source: 'walk_in', position: 0, token: 'A-1', started_at: dayjs().subtract(15, 'minute').toISOString() },
    { customer_name: 'Rahul Mehta', service_name: 'Hair Color', service_id: svc('Hair Color'), staff_id: seat('John'), status: 'waiting', source: 'online', position: 0, token: 'A-2' },
    { customer_name: 'Sana Iqbal', service_name: 'Haircut', service_id: svc('Haircut'), staff_id: seat('John'), status: 'waiting', source: 'online', position: 1, token: 'A-3' },
    { customer_name: 'Vivek Rao', service_name: 'Haircut', service_id: svc('Haircut'), staff_id: seat('Lisa'), status: 'in_service', source: 'online', position: 0, token: 'A-4', started_at: dayjs().subtract(10, 'minute').toISOString() },
    { customer_name: 'Imran Shah', service_name: 'Beard Trim', service_id: null, staff_id: seat('Lisa'), status: 'waiting', source: 'walk_in', position: 0, token: 'A-5' },
  ].map((r) => ({ business_id: bid, token_day: today, ...r }));
  await must(supabase.from('queue_entry').insert(queueRows).select());

  // Set the daily token counter past the seeded tokens so next_token continues at A-6.
  await must(supabase.from('token_counter').upsert({ business_id: bid, day_key: today, seq: 5 }).select());

  // Today's appointments.
  const apptRows = [
    { customer_name: 'Neha Gupta', service_name: 'Keratin Treatment', service_id: null, status: 'confirmed', scheduled_start_at: at('12:30 PM') },
    { customer_name: 'Arjun Das', service_name: 'Haircut', service_id: svc('Haircut'), status: 'confirmed', scheduled_start_at: at('1:00 PM') },
    { customer_name: 'Priya Nair', service_name: 'Hair Spa', service_id: svc('Hair Spa'), status: 'pending', scheduled_start_at: at('2:15 PM') },
    { customer_name: 'Karan Bose', service_name: 'Haircut & Beard', service_id: svc('Haircut & Beard'), status: 'pending', scheduled_start_at: at('3:00 PM') },
  ].map((a) => ({ business_id: bid, source: 'online', ...a }));
  await must(supabase.from('appointment').insert(apptRows).select());

  console.log('✓ Seed complete.');
  console.log(`  business: ${business.name} (slug: sharp-cuts, id: ${bid})`);
  console.log(`  owner login → handle: ${OWNER_HANDLE}  password: ${OWNER_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
