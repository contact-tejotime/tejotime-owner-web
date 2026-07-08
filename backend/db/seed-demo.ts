/**
 * Seed the "Sharp Cuts (Demo)" example tenant — a photo-less reference store shown at the
 * frontend /demo-store route so admin operators can see what a finished store looks like.
 * Mirrors db/seed.ts (Sharp Cuts) but with a stable slug 'demo-store', its own phone, and
 * no images (hero/about/gallery left unset). Idempotent: deletes and recreates 'demo-store'.
 *
 *   npm run seed:demo
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from '../src/db/supabase';
import { parsePriceToPaise } from '../src/domain/money';
import { dayjs } from '../src/lib/time';

const TZ = 'Asia/Kolkata';
const SLUG = 'demo-store';
const OWNER_HANDLE = 'demostore';
const OWNER_PHONE = '919000000000'; // login credential — digits-only full number (own, not the live Sharp Cuts)
const OWNER_PASSWORD = 'password123';

async function must<T>(p: PromiseLike<{ data: T; error: any }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message ?? JSON.stringify(error));
  if (data == null) throw new Error('Expected data from Supabase but got null');
  return data as NonNullable<T>;
}

async function main() {
  console.log('Seeding Sharp Cuts (Demo) …');

  // Clean slate (cascade removes all children).
  await supabase.from('business').delete().eq('slug', SLUG);

  const business = await must(
    supabase
      .from('business')
      .insert({
        slug: SLUG,
        country_code: '91',
        phone_number: '9000000000',
        name: 'Sharp Cuts (Demo)',
        category: 'Salon & Barber',
        area: 'Andheri West',
        address: 'Shop 4, Linking Road, Bandra West, Mumbai',
        city: 'Mumbai',
        tagline: "Bandra's neighbourhood barber",
        hero_subtitle: 'A proper cut, no long waits — track your turn from your phone.',
        stat_value: '20k+',
        stat_label: 'haircuts done',
        about_heading: 'A proper cut, no long waits.',
        description:
          "Since 2014, Sharp Cuts has been Bandra's go-to for classic and modern cuts. Skilled barbers, clean chairs, and a live queue so you never waste time waiting around.",
        established_year: 2014,
        rating: 4.9,
        review_count: 212,
        // Photo-less: hero_image_url / about_image_url / gallery intentionally left unset.
        faqs: [
          { q: 'Do I need an appointment?', a: 'No — walk in any time and join the live queue, or book a slot ahead if you prefer a fixed time.' },
          { q: 'How does the live queue work?', a: 'Join from your phone, get a token, and watch your position update live. We text you when you are two away.' },
          { q: 'Can I pick my barber?', a: "Yes. Choose any available barber, or pick a favourite when you join — you can see each barber's current wait first." },
          { q: 'What payments do you accept?', a: 'UPI, all major cards, and cash. You pay at the shop after your service.' },
        ],
        reviews: [
          { stars: 5, text: 'Best fade in Bandra, and I never wait. Joined the queue from home and walked in right on time.', authorName: 'Aman R.' },
          { stars: 4, text: 'Lisa nailed my colour. Loved seeing the live wait before heading over.', authorName: 'Priya S.' },
          { stars: 5, text: 'Clean, friendly, quick. The token tracking on my phone is genuinely useful.', authorName: 'Rahul M.' },
        ],
        payments: ['UPI', 'Card', 'Cash'],
        timezone: TZ,
        currency: 'INR',
        token_prefix: 'A',
        is_active: true,
      })
      .select()
      .single(),
  );
  const bid = business.id as string;

  await must(
    supabase.from('subscription').insert({ business_id: bid, plan: 'free', status: 'trialing' }).select().single(),
  );

  // Owner login (phone + password) — parity with db/seed.ts.
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD + (process.env.PASSWORD_PEPPER ?? ''), 10);
  await must(
    supabase
      .from('app_user')
      .insert({ business_id: bid, handle: OWNER_HANDLE, phone: OWNER_PHONE, name: 'Demo Store Owner', role: 'owner', password_hash: passwordHash })
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

  // Services.
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

  // Live queue so the demo microsite shows a realistic wait/queue.
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

  console.log('✓ Demo seed complete.');
  console.log(`  business: ${business.name} (slug: ${SLUG}, id: ${bid})`);
  console.log(`  live at /demo-store  ·  owner login → phone: ${OWNER_PHONE}  password: ${OWNER_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
  });
