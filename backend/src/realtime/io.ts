import { Server as HttpServer } from 'node:http';
import { Server, Namespace } from 'socket.io';
import { corsOrigins } from '../config/env';
import { logger } from '../config/logger';
import { UserRole } from '../domain/enums';
import { isOwnerRole } from '../domain/permissions';
import { verifyAccessToken } from '../modules/auth/token.service';
import { verifyTicketKey } from '../modules/auth/token.service';

let io: Server | null = null;
let ownerNs: Namespace | null = null;
let customerNs: Namespace | null = null;

export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins.length ? corsOrigins : true, credentials: true },
  });

  // --- /owner: JWT-authenticated; auto-joins its business room ---
  ownerNs = io.of('/owner');
  ownerNs.use((socket, nextFn) => {
    try {
      const token = (socket.handshake.auth?.token as string) || '';
      const claims = verifyAccessToken(token.replace(/^Bearer\s+/i, ''));
      if (claims.typ !== 'access') return nextFn(new Error('unauthorized'));
      (socket.data as any).businessId = claims.bid;
      (socket.data as any).userId = claims.sub;
      (socket.data as any).role = claims.role;
      (socket.data as any).staffId = claims.sid ?? null;
      nextFn();
    } catch {
      nextFn(new Error('unauthorized'));
    }
  });
  ownerNs.on('connection', (socket) => {
    const bid = (socket.data as any).businessId as string;
    const role = (socket.data as any).role as string;
    const staffId = (socket.data as any).staffId as string | null;

    // `business:{id}` carries the WHOLE shop's queue snapshot — every chair, every customer
    // name. A staff login must not be in it, or the socket would hand back exactly what the
    // REST guards spent this much effort narrowing.
    //
    // Staff sockets join their own seat room instead. Nothing broadcasts there yet, so they
    // fall back to polling until seat-scoped emits land; that is a missing feature, and
    // joining the business room would have been a leak.
    if (isOwnerRole(role as UserRole) || role === 'manager') {
      socket.join(`business:${bid}`);
    } else if (staffId) {
      socket.join(`business:${bid}:seat:${staffId}`);
    }
    socket.emit('connected', { serverTime: new Date().toISOString() });
  });

  // --- /customer: anonymous; joins public + own ticket room ---
  customerNs = io.of('/customer');
  customerNs.on('connection', (socket) => {
    const { businessId, ticketId, ticketKey } = (socket.handshake.auth ?? {}) as {
      businessId?: string;
      ticketId?: string;
      ticketKey?: string;
    };
    if (businessId) socket.join(`public:${businessId}`);
    if (ticketId && ticketKey && verifyTicketKey(ticketId, ticketKey)) {
      socket.join(`ticket:${ticketId}`);
    }
    socket.emit('connected', { serverTime: new Date().toISOString() });
  });

  logger.info('Socket.IO initialized (/owner, /customer)');
  return io;
}

export const getOwnerNs = (): Namespace | null => ownerNs;
export const getCustomerNs = (): Namespace | null => customerNs;
