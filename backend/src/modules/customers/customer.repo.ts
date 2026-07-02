import { supabase } from '../../db/supabase';
import { normalizePhone } from '../../lib/phone';

/** Find a customer by phone within a business, or create a lightweight record. */
export async function findOrCreateCustomer(
  businessId: string,
  name: string,
  phoneRaw: string | null | undefined,
): Promise<string | null> {
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (!phone) return null;

  const { data: existing } = await supabase
    .from('customer')
    .select('id')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('customer')
    .insert({ business_id: businessId, name, phone })
    .select('id')
    .single();
  if (error) {
    // Unique race — re-select.
    const { data: retry } = await supabase
      .from('customer')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();
    return retry?.id ?? null;
  }
  return data.id;
}
