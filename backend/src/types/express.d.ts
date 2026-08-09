import { Principal } from '../http/types';
import { ModuleAccess } from '../domain/permissions';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      principal?: Principal;
      admin?: { mobile: string };
      /** Effective per-module access, resolved once per request by loadAccess(). */
      access?: ModuleAccess;
    }
  }
}

export {};
