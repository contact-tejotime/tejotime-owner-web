import { Request } from 'express';
import { PlanType, UserRole } from '../domain/enums';

/** Authenticated owner-app principal, resolved from the JWT access token. */
export interface Principal {
  type: 'owner';
  userId: string;
  businessId: string;
  role: UserRole;
  plan: PlanType;
}

export interface AuthedRequest extends Request {
  principal: Principal;
  requestId?: string;
}
