import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, validated environment configuration. Fails fast on boot if a
 * required variable is missing or malformed.
 */
const boolish = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined ? def : v === true || v === 'true' || v === '1'),
    z.boolean(),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  PUBLIC_WEB_URL: z.string().url().default('https://tejotime.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default('media'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  // Admin-panel access token lifetime (seconds); default 12h to match the previous session.
  JWT_ADMIN_TTL: z.coerce.number().int().positive().default(43_200),
  CUSTOMER_TOKEN_SECRET: z.string().min(16),
  TICKET_URL_HMAC_SECRET: z.string().min(16),
  PASSWORD_PEPPER: z.string().default(''),

  FREE_PLAN_CUSTOMER_LIMIT: z.coerce.number().int().nonnegative().default(2),
  TWO_AWAY_THRESHOLD: z.coerce.number().int().nonnegative().default(2),
  TICKET_ABANDON_HOURS: z.coerce.number().int().positive().default(4),
  BOOKING_SLOT_MINUTES: z.coerce.number().int().positive().default(30),

  OTP_ENABLED: boolish(false),
  PAYMENTS_ENABLED: boolish(false),
  SMS_ENABLED: boolish(false),
  EMAIL_ENABLED: boolish(false),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_PEPPER: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const isProd = env.NODE_ENV === 'production';
