import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { exec, one } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { PlanType } from '../../domain/enums';
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

async function issueSession(user: { id: string; business_id: string; role: any }, plan: PlanType) {
  const accessToken = signAccessToken({ userId: user.id, businessId: user.business_id, role: user.role, plan });
  const { token: refreshToken, jti } = signRefreshToken(user.id);
  await exec('insert into auth_session (user_id, token_hash, expires_at) values ($1, $2, $3)', [
    user.id,
    sha256(jti),
    new Date(Date.now() + env.JWT_REFRESH_TTL * 1000).toISOString(),
  ]);
  return { accessToken, refreshToken };
}

export async function login(phone: string, password: string) {
  // Match the stored digits-only full number (country code + national). Same convention
  // as business.phone_full / resolveBusinessByPhone — strip anything that isn't a digit.
  const digits = phone.replace(/\D/g, '');
  const user = await one(
    'select id, business_id, phone, password_hash, role, name, dark_mode, is_active from app_user where phone = $1',
    [digits],
  );

  if (!user || !user.is_active) throw Errors.invalidCredentials();
  const ok = await bcrypt.compare(password + env.PASSWORD_PEPPER, user.password_hash);
  if (!ok) throw Errors.invalidCredentials();

  const plan = await planForBusiness(user.business_id);
  const { accessToken, refreshToken } = await issueSession(user, plan);
  await exec('update app_user set last_login_at = $1 where id = $2', [new Date().toISOString(), user.id]);
  const business = await businessSummary(user.business_id);

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL,
    user: { id: user.id, name: user.name, role: user.role, darkMode: user.dark_mode },
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

  const user = await one('select id, business_id, role, is_active from app_user where id = $1', [claims.sub]);
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

export async function me(principal: Principal) {
  const user = await one('select id, name, role, dark_mode from app_user where id = $1', [principal.userId]);
  if (!user) throw Errors.unauthenticated();
  const business = await businessSummary(principal.businessId);
  return {
    user: { id: user.id, name: user.name, role: user.role, darkMode: user.dark_mode },
    business: { ...business, plan: principal.plan },
  };
}
