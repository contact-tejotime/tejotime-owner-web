import { Server as HttpServer } from 'node:http';
import { Server, Namespace } from 'socket.io';
import { corsOrigins } from '../config/env';
import { logger } from '../config/logger';
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
      nextFn();
    } catch {
      nextFn(new Error('unauthorized'));
    }
  });
  ownerNs.on('connection', (socket) => {
    const bid = (socket.data as any).businessId as string;
    socket.join(`business:${bid}`);
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
