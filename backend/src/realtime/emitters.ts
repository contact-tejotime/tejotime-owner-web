import { getCustomerNs, getOwnerNs } from './io';

/** Low-level typed emit helpers. All events fire AFTER the DB commit. */

export function emitToOwners(businessId: string, event: string, payload: unknown): void {
  getOwnerNs()?.to(`business:${businessId}`).emit(event, { businessId, at: new Date().toISOString(), ...(payload as object) });
}

export function emitToPublic(businessId: string, event: string, payload: unknown): void {
  getCustomerNs()?.to(`public:${businessId}`).emit(event, { businessId, at: new Date().toISOString(), ...(payload as object) });
}

export function emitToTicket(ticketId: string, event: string, payload: unknown): void {
  getCustomerNs()?.to(`ticket:${ticketId}`).emit(event, { ticketId, at: new Date().toISOString(), ...(payload as object) });
}
