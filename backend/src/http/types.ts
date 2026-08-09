import { Request } from 'express';
import { PlanType, UserRole } from '../domain/enums';
import { ModuleAccess } from '../domain/permissions';

/** Authenticated owner-app principal, resolved from the JWT access token. */
export interface Principal {
  type: 'owner';
  userId: string;
  businessId: string;
  role: UserRole;
  plan: PlanType;
  /** Linked staff seat. Only set for staff logins; drives own-data-only scoping. */
  staffId: string | null;
  /** The one account per business that cannot be edited or removed from inside the portal. */
  isSuperOwner: boolean;
}

export interface AuthedRequest extends Request {
  principal: Principal;
  requestId?: string;
  /** Resolved once per request by requirePermission / loadAccess. */
  access?: ModuleAccess;
}
