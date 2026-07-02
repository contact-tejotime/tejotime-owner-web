import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { PlanType, UserRole } from '../../domain/enums';

export interface AccessClaims {
  sub: string; // user id
  bid: string; // business id
  role: UserRole;
  plan: PlanType;
  typ: 'access';
}

export interface RefreshClaims {
  sub: string;
  jti: string;
  typ: 'refresh';
}

export interface CustomerClaims {
  phone: string;
  bid: string;
  typ: 'customer';
}

export function signAccessToken(p: { userId: string; businessId: string; role: UserRole; plan: PlanType }): string {
  const claims: AccessClaims = { sub: p.userId, bid: p.businessId, role: p.role, plan: p.plan, typ: 'access' };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL });
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const claims: RefreshClaims = { sub: userId, jti, typ: 'refresh' };
  const token = jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL });
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
}

export function verifyRefreshToken(token: string): RefreshClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshClaims;
}

export function signCustomerToken(phone: string, businessId: string): string {
  const claims: CustomerClaims = { phone, bid: businessId, typ: 'customer' };
  return jwt.sign(claims, env.CUSTOMER_TOKEN_SECRET, { expiresIn: 1800 });
}

export function verifyCustomerToken(token: string): CustomerClaims {
  return jwt.verify(token, env.CUSTOMER_TOKEN_SECRET) as CustomerClaims;
}

/** Signed, unguessable key for public ticket access (HMAC of the ticket id). */
export function ticketKey(ticketId: string): string {
  return createHmac('sha256', env.TICKET_URL_HMAC_SECRET).update(ticketId).digest('hex').slice(0, 24);
}

export function verifyTicketKey(ticketId: string, key: string): boolean {
  const expected = ticketKey(ticketId);
  return key.length === expected.length && createHmacEquals(expected, key);
}

function createHmacEquals(a: string, b: string): boolean {
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
