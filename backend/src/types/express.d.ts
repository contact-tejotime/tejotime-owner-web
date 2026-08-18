import { Principal } from '../http/types';
import { ModuleAccess } from '../domain/permissions';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      principal?: Principal;
      /**
       * Platform admin, loaded fresh from `admins` on every request. `role` is read from the
       * row rather than the JWT so promoting or demoting someone takes effect immediately
       * instead of at their next login.
       */
      admin?: { id: string; mobile: string; role: 'owner' | 'employee' };
      /** Effective per-module access, resolved once per request by loadAccess(). */
      access?: ModuleAccess;
    }
  }
}

export {};
