import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/config';

/**
 * Connect to the owner realtime namespace (JWT-authenticated).
 *
 * Takes a token GETTER, not a token: Socket.IO sends `auth` again on every reconnect, and a
 * token captured at sign-in is expired 15 minutes later. With a fixed token, the first drop after
 * that (phone locked, Wi-Fi → 4G, a deploy) reconnected with a dead JWT, the server refused it,
 * and Socket.IO stopped retrying for good — live updates silently ended until an app restart.
 */
export function connectOwner(getToken: () => string | null): Socket {
  return io(`${SOCKET_URL}/owner`, {
    auth: (cb) => cb({ token: getToken() ?? '' }),
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelayMax: 30_000,
  });
}
