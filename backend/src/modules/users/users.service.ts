import bcrypt from 'bcryptjs';
import { exec, many, one } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { CreatableRole, UserRole } from '../../domain/enums';
import {
  Access,
  ModuleAccess,
  PermissionModule,
  effectiveAccess,
  isOwnerRole,
} from '../../domain/permissions';
import { Principal } from '../../http/types';

/**
 * Business team logins.
 *
 * Who can create whom:
 *   admin panel  → the super owner, once, when the store is provisioned. Never from here.
 *   super owner  → co-owners and staff.
 *   co-owner     → co-owners and staff, but cannot touch the super owner.
 *   staff        → nobody. The router refuses them before this file runs.
 *
 * Permissions only exist for staff. A co-owner is defined as "same powers as the owner", so
 * there is nothing to configure — and letting one co-owner narrow another's access would just
 * be a way for co-owners to fight.
 */

const SUPER_OWNER_ROLE: UserRole = 'owner';

export interface UserDTO {
  id: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  isSuperOwner: boolean;
  isActive: boolean;
  staffId: string | null;
  staffName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  /** Role defaults with this user's overrides applied — what the guards will actually enforce. */
  permissions: ModuleAccess;
  /** Only the deliberate overrides, so the editor can show "default" versus "changed". */
  overrides: Partial<Record<PermissionModule, Access>>;
}

function rowToDTO(row: any, overrides: Partial<Record<PermissionModule, Access>>): UserDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    isSuperOwner: row.is_super_owner === true,
    isActive: row.is_active,
    staffId: row.staff_id ?? null,
    staffName: row.staff_name ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    permissions: effectiveAccess(row.role, overrides),
    overrides: isOwnerRole(row.role) ? {} : overrides,
  };
}

async function overridesFor(userIds: string[]) {
  const byUser = new Map<string, Partial<Record<PermissionModule, Access>>>();
  if (userIds.length === 0) return byUser;
  const rows = await many<{ user_id: string; module: string; access: string }>(
    'select user_id, module, access from user_permission where user_id = any($1::uuid[])',
    [userIds],
  );
  for (const r of rows) {
    const bucket = byUser.get(r.user_id) ?? {};
    bucket[r.module as PermissionModule] = r.access as Access;
    byUser.set(r.user_id, bucket);
  }
  return byUser;
}

const SELECT_USER = `
  select u.*, s.name as staff_name
    from app_user u
    left join staff s on s.id = u.staff_id
`;

export async function listUsers(businessId: string): Promise<{ data: UserDTO[] }> {
  const rows = await many(
    `${SELECT_USER}
      where u.business_id = $1
      order by u.is_super_owner desc, u.role, coalesce(u.name, ''), u.created_at`,
    [businessId],
  );
  const overrides = await overridesFor(rows.map((r: any) => r.id));
  return { data: rows.map((r: any) => rowToDTO(r, overrides.get(r.id) ?? {})) };
}

async function loadUser(businessId: string, userId: string) {
  const row = await one(`${SELECT_USER} where u.id = $1 and u.business_id = $2`, [userId, businessId]);
  if (!row) throw Errors.notFound('User not found');
  return row;
}

export async function getUser(businessId: string, userId: string): Promise<UserDTO> {
  const row = await loadUser(businessId, userId);
  const overrides = await overridesFor([row.id]);
  return rowToDTO(row, overrides.get(row.id) ?? {});
}

/**
 * The rules that stop the team screen from being a way to take over a business.
 * Every mutation runs this before touching anything.
 */
function assertMayModify(actor: Principal, target: any) {
  if (target.is_super_owner) {
    throw Errors.forbidden('The business owner account cannot be changed from here');
  }
  if (target.id === actor.userId) {
    throw Errors.forbidden('You cannot change your own role or access here');
  }
  if (isOwnerRole(target.role) && !isOwnerRole(actor.role)) {
    throw Errors.forbidden('Only an owner can manage another owner');
  }
}

async function hashPassword(plain: string) {
  return bcrypt.hash(plain + env.PASSWORD_PEPPER, 10);
}

/** Unique, human-recognisable login handle. `handle` is globally unique across all businesses. */
async function generateHandle(businessId: string, name: string): Promise<string> {
  const biz = await one<{ slug: string }>('select slug from business where id = $1', [businessId]);
  const base = `${biz?.slug ?? 'biz'}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'user';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const clash = await one('select 1 from app_user where handle = $1', [candidate]);
    if (!clash) return candidate;
  }
  throw Errors.conflict('HANDLE_TAKEN', 'Could not allocate a login handle');
}

/**
 * Store the full international number, the way `app_user.phone` is supposed to be written.
 *
 * This endpoint used to store whatever digits it was given. An owner adding a staff member
 * naturally types their 10-digit mobile, so the row went in without a country code — and the
 * mobile app, whose picker always sends `91` + national, could then never sign that person in.
 * The login lookup tolerates both shapes for the rows already out there; this stops making
 * more of them.
 *
 * The business's own country code is the default, which is right for essentially every real
 * team. A number long enough to already carry a country code is left alone: national numbers
 * run about 10 digits, so anything at least `cc.length + 9` is treated as already complete.
 */
const NATIONAL_MIN_DIGITS = 9;

async function toFullPhone(businessId: string, raw: string): Promise<string> {
  const digits = raw.replace(/\D/g, '');
  const biz = await one<{ country_code: string | null }>(
    'select country_code from business where id = $1',
    [businessId],
  );
  const cc = (biz?.country_code ?? '').replace(/\D/g, '');
  if (!cc) return digits;
  if (digits.length >= cc.length + NATIONAL_MIN_DIGITS) return digits;
  return cc + digits;
}

async function assertPhoneFree(phone: string, exceptUserId?: string) {
  const clash = await one('select id from app_user where phone = $1', [phone]);
  if (clash && clash.id !== exceptUserId) {
    throw Errors.conflict('PHONE_TAKEN', 'That mobile number already has a TejoTime login');
  }
}

/** A seat must belong to this business and be free — one chair backs at most one login. */
async function assertStaffAssignable(businessId: string, staffId: string, exceptUserId?: string) {
  const seat = await one('select id from staff where id = $1 and business_id = $2', [staffId, businessId]);
  if (!seat) throw Errors.notFound('Staff member not found');
  const taken = await one('select id from app_user where staff_id = $1', [staffId]);
  if (taken && taken.id !== exceptUserId) {
    throw Errors.conflict('STAFF_LINKED', 'That staff member already has a login');
  }
}

export interface CreateUserInput {
  name: string;
  phone: string;
  password: string;
  role: CreatableRole;
  staffId?: string | null;
  permissions?: Partial<Record<PermissionModule, Access>>;
}

export async function createUser(actor: Principal, input: CreateUserInput): Promise<UserDTO> {
  const businessId = actor.businessId;
  const phone = await toFullPhone(businessId, input.phone);
  if (phone.length < 10) throw Errors.validation('Enter a full mobile number');
  await assertPhoneFree(phone);

  if (input.role === 'staff') {
    if (!input.staffId) {
      throw Errors.validation('Pick a chair for this staff login. You cannot add more staff than you have chairs.');
    }
    await assertStaffAssignable(businessId, input.staffId);
  } else if (input.staffId) {
    throw Errors.validation('Only a staff login can be linked to a chair');
  }

  const handle = await generateHandle(businessId, input.name);
  const passwordHash = await hashPassword(input.password);

  const created = await one(
    `insert into app_user (business_id, handle, phone, name, role, password_hash, staff_id, created_by_user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [businessId, handle, phone, input.name, input.role, passwordHash, input.staffId ?? null, actor.userId],
  );

  if (input.permissions && input.role === 'staff') {
    await setPermissions(actor, created!.id, input.permissions);
  }
  return getUser(businessId, created!.id);
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  role?: CreatableRole;
  staffId?: string | null;
  isActive?: boolean;
}

export async function updateUser(
  actor: Principal,
  userId: string,
  input: UpdateUserInput,
): Promise<UserDTO> {
  const target = await loadUser(actor.businessId, userId);
  assertMayModify(actor, target);

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) row.name = input.name;
  if (input.phone !== undefined) {
    const phone = await toFullPhone(actor.businessId, input.phone);
    if (phone.length < 10) throw Errors.validation('Enter a full mobile number');
    await assertPhoneFree(phone, userId);
    row.phone = phone;
  }
  if (input.isActive !== undefined) row.is_active = input.isActive;

  // Role and seat interact: promoting a staff login to co-owner has to release its chair,
  // because "co-owner" means shop-wide and a linked chair would keep narrowing its reads.
  const nextRole = (input.role ?? target.role) as UserRole;
  if (input.role !== undefined) row.role = input.role;
  if (nextRole !== 'staff') {
    row.staff_id = null;
  } else if (input.staffId !== undefined) {
    if (!input.staffId) {
      throw Errors.validation('A staff login must stay linked to a chair');
    }
    await assertStaffAssignable(actor.businessId, input.staffId, userId);
    row.staff_id = input.staffId;
  }
  // Overrides are meaningless for an owner role — drop them rather than leave them to
  // reappear if the user is ever demoted back to staff with someone else's settings.
  if (nextRole !== 'staff' && nextRole !== target.role) {
    await exec('delete from user_permission where user_id = $1', [userId]);
  }

  const columns = Object.keys(row);
  const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await exec(
    `update app_user set ${sets} where id = $${columns.length + 1} and business_id = $${columns.length + 2}`,
    [...Object.values(row), userId, actor.businessId],
  );

  // A deactivated login must lose its live sessions immediately; refresh alone already
  // rejects inactive users, but the 15-minute access token would otherwise keep working.
  if (input.isActive === false) await revokeSessions(userId);

  return getUser(actor.businessId, userId);
}

export async function setPermissions(
  actor: Principal,
  userId: string,
  permissions: Partial<Record<PermissionModule, Access>>,
): Promise<UserDTO> {
  const target = await loadUser(actor.businessId, userId);
  assertMayModify(actor, target);
  if (isOwnerRole(target.role)) {
    throw Errors.validation('Co-owners have full access — there is nothing to configure');
  }

  // Replace wholesale: the editor always sends the complete map, so a module the owner reset
  // back to its default disappears rather than lingering as a stale override.
  await exec('delete from user_permission where user_id = $1', [userId]);
  const entries = Object.entries(permissions);
  if (entries.length) {
    const values = entries.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
    await exec(
      `insert into user_permission (user_id, module, access) values ${values}`,
      [userId, ...entries.flatMap(([m, a]) => [m, a])],
    );
  }
  return getUser(actor.businessId, userId);
}

export async function resetPassword(actor: Principal, userId: string, password: string) {
  const target = await loadUser(actor.businessId, userId);
  assertMayModify(actor, target);
  await exec('update app_user set password_hash = $1, updated_at = $2 where id = $3', [
    await hashPassword(password),
    new Date().toISOString(),
    userId,
  ]);
  // Whoever held the old password is signed out everywhere. That is the point of a reset.
  await revokeSessions(userId);
  return { ok: true };
}

/** Deactivate, never delete — `visit`, `queue_entry` and the audit log all point back here. */
export async function deactivateUser(actor: Principal, userId: string) {
  const target = await loadUser(actor.businessId, userId);
  assertMayModify(actor, target);
  await exec('update app_user set is_active = false, updated_at = $1 where id = $2', [
    new Date().toISOString(),
    userId,
  ]);
  await revokeSessions(userId);
  return { ok: true };
}

async function revokeSessions(userId: string) {
  await exec('update auth_session set revoked_at = $1 where user_id = $2 and revoked_at is null', [
    new Date().toISOString(),
    userId,
  ]);
}

/** Self-service password change — any signed-in user, current password required. */
export async function changeOwnPassword(
  principal: Principal,
  currentPassword: string,
  newPassword: string,
) {
  const user = await one('select id, password_hash from app_user where id = $1', [principal.userId]);
  if (!user) throw Errors.unauthenticated();
  const ok = await bcrypt.compare(currentPassword + env.PASSWORD_PEPPER, user.password_hash);
  if (!ok) throw Errors.validation('Your current password is not correct');
  await exec('update app_user set password_hash = $1, updated_at = $2 where id = $3', [
    await hashPassword(newPassword),
    new Date().toISOString(),
    principal.userId,
  ]);
  return { ok: true };
}

export { SUPER_OWNER_ROLE };
