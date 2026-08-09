import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { exec, many, one } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { PlanType, UserRole } from '../../domain/enums';
import { Access, effectiveAccess, isOwnerRole } from '../../domain/permissions';
import { Principal } from '../../http/types';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './token.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function planForBusiness(businessId: string): Promise<PlanType> {
  const row = await one('select plan from subscription where business_id = $1', [businessId]);
  return (row?.plan as PlanType) ?? 'free';
}

async function businessSummary(businessId: string) {
  return one('select id, name, slug from business where id = $1', [businessId]);
}

async function issueSession(
  user: { id: string; business_id: string; role: any; staff_id?: string | null; is_super_owner?: boolean },
  plan: PlanType,
) {
  const accessToken = signAccessToken({
    userId: user.id,
    businessId: user.business_id,
    role: user.role,
    plan,
    staffId: user.staff_id ?? null,
    isSuperOwner: user.is_super_owner === true,
  });
  const { token: refreshToken, jti } = signRefreshToken(user.id);
  await exec('insert into auth_session (user_id, token_hash, expires_at) values ($1, $2, $3)', [
    user.id,
    sha256(jti),
    new Date(Date.now() + env.JWT_REFRESH_TTL * 1000).toISOString(),
  ]);
  return { accessToken, refreshToken };
}

/**
 * `accountType` is the Owner/Staff switch on the sign-in screen. It is a guard rail, not a
 * second credential — the password still decides everything. Its job is to turn "wrong
 * password?" confusion into a specific message when someone picks the wrong side, which is
 * the common mistake once a shop has both kinds of login.
 */
function assertAccountType(role: UserRole, accountType?: 'owner' | 'staff') {
  if (!accountType) return;
  const isOwnerSide = isOwnerRole(role) || role === 'manager';
  if (accountType === 'owner' && !isOwnerSide) {
    throw Errors.forbidden('This is a staff login. Choose “Staff” to sign in.');
  }
  if (accountType === 'staff' && isOwnerSide) {
    throw Errors.forbidden('This is an owner login. Choose “Owner” to sign in.');
  }
}

/**
 * Find a login by phone, tolerating a missing country code on either side.
 *
 * The convention is that `app_user.phone` holds digits-only FULL numbers (country code +
 * national), and most rows do. But two writers have historically stored a bare national number
 * instead — `admin.service` when the admin types a separate owner phone, and the team-login
 * endpoint before it normalised — so the column contains both shapes.
 *
 * That mattered the moment there were two clients. The web portal sends exactly what the user
 * typed, while the mobile app has a country-code picker and always sends `91` + national. The
 * same person with the same password therefore signed in on one and got INVALID_CREDENTIALS on
 * the other, purely because of how their row happened to be written.
 *
 * So all three combinations are accepted, using the business's own country code:
 *   1. exact                          — stored and typed agree
 *   2. stored full, typed national    — web user omits their country code
 *   3. stored national, typed full    — mobile user's picker adds it
 *
 * A match must be UNIQUE. Two businesses in different countries could in principle both match
 * a bare national number; rather than guess which, that is treated as no match at all.
 * Normalisation on write (users.service) means new rows only ever need case 1.
 */
async function findLoginByPhone(digits: string) {
  const rows = await many(
    `select u.id, u.business_id, u.phone, u.password_hash, u.role, u.name, u.dark_mode,
            u.is_active, u.staff_id, u.is_super_owner
       from app_user u
       join business b on b.id = u.business_id
      where u.phone = $1
         or u.phone = b.country_code || $1
         or b.country_code || u.phone = $1`,
    [digits],
  );
  return rows.length === 1 ? rows[0] : null;
}

export async function login(phone: string, password: string, accountType?: 'owner' | 'staff') {
  // Strip anything that isn't a digit — same convention as business.phone_full.
  const digits = phone.replace(/\D/g, '');
  const user = await findLoginByPhone(digits);

  if (!user || !user.is_active) throw Errors.invalidCredentials();
  const ok = await bcrypt.compare(password + env.PASSWORD_PEPPER, user.password_hash);
  if (!ok) throw Errors.invalidCredentials();
  // Only after the password checks out — otherwise the message would leak whether a number
  // belongs to an owner or a staff member to anyone who guesses.
  assertAccountType(user.role, accountType);

  const plan = await planForBusiness(user.business_id);
  const { accessToken, refreshToken } = await issueSession(user, plan);
  await exec('update app_user set last_login_at = $1 where id = $2', [new Date().toISOString(), user.id]);
  const business = await businessSummary(user.business_id);

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL,
    user: await userDTO(user),
    business: { ...business, plan },
  };
}

export async function refresh(refreshToken: string) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw Errors.unauthenticated('Invalid refresh token');
  }
  const session = await one(
    'select id, revoked_at from auth_session where user_id = $1 and token_hash = $2',
    [claims.sub, sha256(claims.jti)],
  );
  if (!session || session.revoked_at) throw Errors.unauthenticated('Session expired');

  // Re-read role, seat and super-owner flag on every rotation, so a permission or role change
  // takes effect within one access-token lifetime instead of at the next sign-in.
  const user = await one(
    'select id, business_id, role, is_active, staff_id, is_super_owner from app_user where id = $1',
    [claims.sub],
  );
  if (!user || !user.is_active) throw Errors.unauthenticated();

  // Rotate: revoke old, issue new.
  await exec('update auth_session set revoked_at = $1 where id = $2', [new Date().toISOString(), session.id]);
  const plan = await planForBusiness(user.business_id);
  const { accessToken, refreshToken: newRefresh } = await issueSession(user, plan);
  return { accessToken, refreshToken: newRefresh, expiresIn: env.JWT_ACCESS_TTL };
}

export async function logout(refreshToken: string) {
  try {
    const claims = verifyRefreshToken(refreshToken);
    await exec('update auth_session set revoked_at = $1 where user_id = $2 and token_hash = $3', [
      new Date().toISOString(),
      claims.sub,
      sha256(claims.jti),
    ]);
  } catch {
    /* already invalid — treat as success */
  }
  return { ok: true };
}

/**
 * The signed-in user, including the permission map the portal renders its navigation from.
 *
 * Sending the resolved map — role defaults with overrides applied — rather than the raw role
 * keeps one answer to "what can this person see": the same `effectiveAccess` the route guards
 * call. The UI cannot drift from the API because it is not computing anything.
 */
async function userDTO(user: any) {
  let overrides: Record<string, Access> = {};
  if (!isOwnerRole(user.role)) {
    const rows = await many<{ module: string; access: string }>(
      'select module, access from user_permission where user_id = $1',
      [user.id],
    );
    overrides = Object.fromEntries(rows.map((r) => [r.module, r.access as Access]));
  }
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    darkMode: user.dark_mode,
    isSuperOwner: user.is_super_owner === true,
    staffId: user.staff_id ?? null,
    permissions: effectiveAccess(user.role, overrides),
  };
}

export async function me(principal: Principal) {
  const user = await one(
    'select id, name, role, dark_mode, staff_id, is_super_owner from app_user where id = $1',
    [principal.userId],
  );
  if (!user) throw Errors.unauthenticated();
  const business = await businessSummary(principal.businessId);
  return {
    user: await userDTO(user),
    business: { ...business, plan: principal.plan },
  };
}
