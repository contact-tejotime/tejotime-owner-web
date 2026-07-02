import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/config';

/** Connect to the owner realtime namespace (JWT-authenticated). */
export function connectOwner(token: string): Socket {
  return io(`${SOCKET_URL}/owner`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  });
}
