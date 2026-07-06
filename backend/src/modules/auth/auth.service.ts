import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { supabase } from '../../db/supabase';
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
  const { data } = await supabase.from('subscription').select('plan').eq('business_id', businessId).maybeSingle();
  return (data?.plan as PlanType) ?? 'free';
}

async function businessSummary(businessId: string) {
  const { data } = await supabase
    .from('business')
    .select('id, name, slug')
    .eq('id', businessId)
    .maybeSingle();
  return data;
}

async function issueSession(user: { id: string; business_id: string; role: any }, plan: PlanType) {
  const accessToken = signAccessToken({ userId: user.id, businessId: user.business_id, role: user.role, plan });
  const { token: refreshToken, jti } = signRefreshToken(user.id);
  await supabase.from('auth_session').insert({
    user_id: user.id,
    token_hash: sha256(jti),
    expires_at: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000).toISOString(),
  });
  return { accessToken, refreshToken };
}

export async function login(phone: string, password: string) {
  // Match the stored digits-only full number (country code + national). Same convention
  // as business.phone_full / resolveBusinessByPhone — strip anything that isn't a digit.
  const digits = phone.replace(/\D/g, '');
  const { data: user } = await supabase
    .from('app_user')
    .select('id, business_id, phone, password_hash, role, name, dark_mode, is_active')
    .eq('phone', digits)
    .maybeSingle();

  if (!user || !user.is_active) throw Errors.invalidCredentials();
  const ok = await bcrypt.compare(password + env.PASSWORD_PEPPER, user.password_hash);
  if (!ok) throw Errors.invalidCredentials();

  const plan = await planForBusiness(user.business_id);
  const { accessToken, refreshToken } = await issueSession(user, plan);
  await supabase.from('app_user').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
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
  const { data: session } = await supabase
    .from('auth_session')
    .select('id, revoked_at')
    .eq('user_id', claims.sub)
    .eq('token_hash', sha256(claims.jti))
    .maybeSingle();
  if (!session || session.revoked_at) throw Errors.unauthenticated('Session expired');

  const { data: user } = await supabase
    .from('app_user')
    .select('id, business_id, role, is_active')
    .eq('id', claims.sub)
    .maybeSingle();
  if (!user || !user.is_active) throw Errors.unauthenticated();

  // Rotate: revoke old, issue new.
  await supabase.from('auth_session').update({ revoked_at: new Date().toISOString() }).eq('id', session.id);
  const plan = await planForBusiness(user.business_id);
  const { accessToken, refreshToken: newRefresh } = await issueSession(user, plan);
  return { accessToken, refreshToken: newRefresh, expiresIn: env.JWT_ACCESS_TTL };
}

export async function logout(refreshToken: string) {
  try {
    const claims = verifyRefreshToken(refreshToken);
    await supabase
      .from('auth_session')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', claims.sub)
      .eq('token_hash', sha256(claims.jti));
  } catch {
    /* already invalid — treat as success */
  }
  return { ok: true };
}

export async function me(principal: Principal) {
  const { data: user } = await supabase
    .from('app_user')
    .select('id, name, role, dark_mode')
    .eq('id', principal.userId)
    .maybeSingle();
  if (!user) throw Errors.unauthenticated();
  const business = await businessSummary(principal.businessId);
  return {
    user: { id: user.id, name: user.name, role: user.role, darkMode: user.dark_mode },
    business: { ...business, plan: principal.plan },
  };
}
