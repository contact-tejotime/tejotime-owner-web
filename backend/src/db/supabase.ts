import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Service-role Supabase client — the single data-access entry point at runtime
 * (no ORM). Bypasses RLS; every query in the codebase MUST scope by business_id
 * explicitly (tenant isolation is enforced in the service layer, not by RLS).
 *
 * DDL/migrations are handled separately by db/migrate.ts over a direct pg
 * connection, because PostgREST cannot run DDL.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  },
);
