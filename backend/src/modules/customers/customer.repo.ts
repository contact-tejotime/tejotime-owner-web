import { one } from '../../db/pool';
import { normalizePhone } from '../../lib/phone';

/** Find a customer by phone within a business, or create a lightweight record. */
export async function findOrCreateCustomer(
  businessId: string,
  name: string,
  phoneRaw: string | null | undefined,
): Promise<string | null> {
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (!phone) return null;

  const existing = await one<{ id: string }>(
    'select id from customer where business_id = $1 and phone = $2',
    [businessId, phone],
  );
  if (existing) return existing.id;

  try {
    const created = await one<{ id: string }>(
      'insert into customer (business_id, name, phone) values ($1, $2, $3) returning id',
      [businessId, name, phone],
    );
    return created?.id ?? null;
  } catch {
    // Unique race — re-select.
    const retry = await one<{ id: string }>(
      'select id from customer where business_id = $1 and phone = $2',
      [businessId, phone],
    );
    return retry?.id ?? null;
  }
}
