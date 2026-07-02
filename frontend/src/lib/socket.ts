import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "./config";

export interface CustomerAuth {
  businessId: string;
  ticketId?: string;
  ticketKey?: string;
}

/**
 * Connect to the /customer namespace. Joins the business public room (live
 * availability) and, when a ticket is provided, that ticket's room (live
 * position). Reconnect with new auth to (un)subscribe from a ticket.
 */
export function connectCustomer(auth: CustomerAuth): Socket {
  return io(`${SOCKET_URL}/customer`, {
    auth,
    transports: ["websocket"],
    reconnection: true,
  });
}
