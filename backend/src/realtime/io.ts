import { Server as HttpServer } from 'node:http';
import { Server, Namespace } from 'socket.io';
import { corsOrigins } from '../config/env';
import { logger } from '../config/logger';
import { UserRole } from '../domain/enums';
import { isOwnerRole } from '../domain/permissions';
import { verifyOwnerSocketCredential, verifyTicketKey } from '../modules/auth/token.service';

let io: Server | null = null;
let ownerNs: Namespace | null = null;
let customerNs: Namespace | null = null;

export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins.length ? corsOrigins : true, credentials: true },
    // Socket.IO's defaults, pinned on purpose: owner dashboards sit idle for hours. A ping every
    // 25s keeps load balancers and proxies from reaping a quiet connection, and a peer that
    // stops answering (laptop asleep, network gone) is dropped within ~45s so the client
    // reconnects instead of sitting on a half-dead socket. Credentials are checked only at the
    // handshake, so an expired token or ticket never ends a connection that is already open.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // --- /owner: JWT-authenticated; auto-joins its business room ---
  ownerNs = io.of('/owner');
  ownerNs.use((socket, nextFn) => {
    try {
      const token = (socket.handshake.auth?.token as string) || '';
      // The mobile app sends its access token; owner-web sends a 60s socket ticket, because its
      // access token is an httpOnly cookie (see signSocketTicket). Either carries the same claims.
      const claims = verifyOwnerSocketCredential(token.replace(/^Bearer\s+/i, ''));
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
