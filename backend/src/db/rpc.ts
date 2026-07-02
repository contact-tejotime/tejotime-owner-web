import { supabase } from './supabase';

/** Call a Postgres function; throw on error so the error middleware maps TEJO:* codes. */
export async function callRpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
