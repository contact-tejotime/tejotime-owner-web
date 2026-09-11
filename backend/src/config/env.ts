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
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  /** Postgres connection string — used by the runtime pool AND the migration CLI. */
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * S3-compatible object storage (Railway Buckets). The bucket is private, so
   * reads go through GET /media/* which redirects to a short-lived signed URL.
   */
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  /** Older Railway buckets need path-style URLs; newer ones use virtual-hosted style. */
  S3_FORCE_PATH_STYLE: boolish(false),
  /** Lifetime of a signed upload (PUT) URL, seconds. */
  S3_UPLOAD_URL_TTL: z.coerce.number().int().positive().default(600),
  /** Lifetime of a signed download (GET) URL that /media/* redirects to, seconds. */
  S3_DOWNLOAD_URL_TTL: z.coerce.number().int().positive().default(3_600),

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
  /** Minutes of wait at/under which the online-queue WhatsApp alert fires (once). */
  ETA_NOTIFY_MINUTES: z.coerce.number().int().positive().default(15),
  TICKET_ABANDON_HOURS: z.coerce.number().int().positive().default(4),
  BOOKING_SLOT_MINUTES: z.coerce.number().int().positive().default(30),

  OTP_ENABLED: boolish(false),
  PAYMENTS_ENABLED: boolish(false),
  SMS_ENABLED: boolish(false),
  EMAIL_ENABLED: boolish(false),
  WHATSAPP_ENABLED: boolish(false),
  /** Provider base URL — leave blank until credentials are supplied. */
  WHATSAPP_API_URL: z.string().default(''),
  WHATSAPP_API_TOKEN: z.string().default(''),
  /** Meta webhook verify token — must match the value entered in the Meta dashboard. */
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_TEMPLATE_ETA_15: z.string().default('eta_15'),

  /**
   * Temporary Twilio SMS stand-in for ETA-15 alerts (swap for real WhatsApp later).
   * When WHATSAPP_ENABLED=true and these are set, whatsappSender POSTs to Twilio Messages.
   */
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),
  /** Optional override: when set, ALL alert sends go here (never message real customers in test). */
  TWILIO_TEST_TO: z.string().default(''),

  /**
   * Customer microsite chatbot (docs/customer-chatbot-v1.md). OFF by default: the widget is
   * hidden and the endpoint answers 404 until an operator turns it on. With the flag on but no
   * provider (or no key) it still answers — from the store's FAQs and public facts, with no
   * external call at all. A provider is an optional upgrade, never a requirement, and the free
   * tiers (Gemini, Groq) are the intended defaults; OpenAI is accepted but never assumed.
   */
  CHATBOT_ENABLED: boolish(false),
  CHATBOT_PROVIDER: z.enum(['none', 'gemini', 'groq', 'openai']).default('none'),
  /** Server-side only. Never mirrored into a NEXT_PUBLIC_* / EXPO_PUBLIC_* variable. */
  CHATBOT_API_KEY: z.string().default(''),
  /** Blank ⇒ the provider's free-tier default in integrations/chatbot.ts. */
  CHATBOT_MODEL: z.string().default(''),
  /** How many prior turns the client may send back; the bot itself stores nothing. */
  CHATBOT_MAX_HISTORY: z.coerce.number().int().min(0).max(20).default(8),
  CHATBOT_MAX_MESSAGE_CHARS: z.coerce.number().int().min(50).max(2000).default(500),
  /** A slow model must degrade to the FAQ answer, not hang the page. */
  CHATBOT_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

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
