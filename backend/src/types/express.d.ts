import { Principal } from '../http/types';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      principal?: Principal;
    }
  }
}

export {};
