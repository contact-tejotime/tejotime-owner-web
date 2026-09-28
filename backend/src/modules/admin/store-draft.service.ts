import { exec, many, one } from '../../db/pool';
import { Errors } from '../../domain/errors';

/**
 * Admin-panel "Create store" drafts (migration 0031).
 *
 * A draft is a parked copy of the form, private to the admin who saved it. Every query filters on
 * `admin_id`, and a draft that belongs to someone else is a 404 rather than a 403 — the same
 * answer as one that never existed, so the id cannot be probed.
 */

/** Per admin. Drafts are meant to be finished or discarded, not hoarded. */
export const MAX_DRAFTS_PER_ADMIN = 50;

export interface DraftListItem {
  id: string;
  name: string | null;
  category: string | null;
  phoneFull: string | null;
  updatedAt: string;
}

export interface Draft {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Never persist the owner's password. It is a plaintext secret typed into a form field; a jsonb
 * column (and every backup of it) is the wrong place for it. Enforced here, not just in the panel,
 * so a client that forgets to strip it still cannot store one.
 */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const { ownerPassword: _dropped, ...rest } = data;
  const owner = rest.owner;
  if (owner && typeof owner === 'object' && !Array.isArray(owner)) {
    const { password: _pw, ...ownerRest } = owner as Record<string, unknown>;
    rest.owner = ownerRest;
  }
  return rest;
}

function nameOf(data: Record<string, unknown>): string | null {
  return typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function listDrafts(adminId: string): Promise<DraftListItem[]> {
  const rows = await many<{ id: string; name: string | null; data: Record<string, unknown>; updated_at: Date }>(
    `select id, name, data, updated_at
       from store_draft
      where admin_id = $1
      order by updated_at desc`,
    [adminId],
  );
  return rows.map((r) => {
    const cc = str(r.data?.countryCode) ?? '';
    const pn = str(r.data?.phoneNumber) ?? '';
    return {
      id: r.id,
      name: r.name,
      category: str(r.data?.category),
      // Same shape as a store's `phoneFull` so the sidebar can render both alike.
      phoneFull: cc && pn ? `${cc}${pn}` : null,
      updatedAt: r.updated_at.toISOString(),
    };
  });
}

export async function getDraft(adminId: string, id: string): Promise<Draft> {
  const row = await one<{ id: string; data: Record<string, unknown>; updated_at: Date }>(
    `select id, data, updated_at from store_draft where id = $1 and admin_id = $2`,
    [id, adminId],
  );
  if (!row) throw Errors.notFound('Draft not found');
  return { id: row.id, data: row.data, updatedAt: row.updated_at.toISOString() };
}

export async function createDraft(adminId: string, data: Record<string, unknown>): Promise<Draft> {
  const clean = sanitize(data);
  // Count then insert is not atomic, so two concurrent creates could land the 51st. Harmless: the
  // cap exists to stop runaway accumulation, not to be an exact quota.
  const count = await one<{ n: string }>(`select count(*)::text as n from store_draft where admin_id = $1`, [adminId]);
  if (Number(count?.n ?? 0) >= MAX_DRAFTS_PER_ADMIN) {
    throw Errors.conflict(
      'DRAFT_LIMIT',
      `You can keep up to ${MAX_DRAFTS_PER_ADMIN} drafts. Discard one to save another.`,
    );
  }
  const row = await one<{ id: string; updated_at: Date }>(
    `insert into store_draft (admin_id, name, data)
     values ($1, $2, $3::jsonb)
     returning id, updated_at`,
    [adminId, nameOf(clean), JSON.stringify(clean)],
  );
  return { id: row!.id, data: clean, updatedAt: row!.updated_at.toISOString() };
}

export async function updateDraft(adminId: string, id: string, data: Record<string, unknown>): Promise<Draft> {
  const clean = sanitize(data);
  const row = await one<{ id: string; updated_at: Date }>(
    `update store_draft
        set name = $3, data = $4::jsonb, updated_at = now()
      where id = $1 and admin_id = $2
      returning id, updated_at`,
    [id, adminId, nameOf(clean), JSON.stringify(clean)],
  );
  if (!row) throw Errors.notFound('Draft not found');
  return { id: row.id, data: clean, updatedAt: row.updated_at.toISOString() };
}

/**
 * Idempotent: deleting a draft that is already gone succeeds. The panel deletes after a store is
 * created and again on "Discard", and a double click or a second tab must not surface an error.
 */
export async function deleteDraft(adminId: string, id: string): Promise<void> {
  await exec(`delete from store_draft where id = $1 and admin_id = $2`, [id, adminId]);
}
