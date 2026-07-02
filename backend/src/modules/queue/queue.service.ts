import { supabase } from '../../db/supabase';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { SERVICE_EXTRAS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { initials } from '../../lib/format';
import {
  buildSeatGroups,
  flatCards,
  soonestSeat,
  ticketPosition,
  CardVM,
  SeatGroupVM,
} from '../../lib/queue-engine';
import { emitToOwners, emitToPublic, emitToTicket } from '../../realtime/emitters';
import { findOrCreateCustomer } from '../customers/customer.repo';
import { loadQueueContext, QueueContext } from './queue.context';

// ---------- DTO mappers ----------
function cardToDTO(c: CardVM) {
  return {
    id: c.id,
    name: c.name,
    service: c.service,
    status: c.status,
    position: c.pos,
    source: c.online ? 'online' : 'walk_in',
    rightText: c.rightText,
    etaMinutes: c.etaMinutes,
    initials: c.initials,
    seatId: c.staffId,
    seatName: c.seatName,
    seatColor: c.seatColor,
    online: c.online,
  };
}

function seatToDTO(g: SeatGroupVM) {
  return {
    id: g.id,
    name: g.name,
    colorToken: g.color,
    serving: g.serving,
    servingName: g.servingName,
    subLine: g.subLine,
    waitBadge: g.waitBadge,
    waitingCount: g.waitingCount,
    clearMinutes: g.clearMinutes,
    free: g.free,
    empty: g.empty,
    cards: g.cards.map(cardToDTO),
  };
}

function summarize(ctx: QueueContext) {
  const waitingCount = ctx.engineEntries.filter((e) => e.status === 'waiting').length;
  return { seatCount: ctx.engineStaff.length, activeCount: ctx.engineEntries.length, waitingCount };
}

// ---------- Reads ----------
export interface QueueViewOpts {
  view?: 'grouped' | 'flat';
  staffId?: string;
}

export async function getQueueView(businessId: string, opts: QueueViewOpts = {}) {
  const ctx = await loadQueueContext(businessId);
  const groups = buildSeatGroups(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const filtered = opts.staffId && opts.staffId !== 'all' ? groups.filter((g) => g.id === opts.staffId) : groups;
  const summary = summarize(ctx);
  if (opts.view === 'flat') return { cards: flatCards(filtered).map(cardToDTO), summary };
  return { seats: filtered.map(seatToDTO), summary };
}

export async function getEntryDetail(businessId: string, entryId: string) {
  const ctx = await loadQueueContext(businessId);
  const groups = buildSeatGroups(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const card = flatCards(groups).find((c) => c.id === entryId);
  if (card) {
    return {
      id: card.id,
      name: card.name,
      initials: card.initials,
      status: card.status,
      service: card.service,
      source: card.online ? 'online' : 'walk_in',
      sourceLabel: card.online ? 'Booked online' : 'Walk-in',
      seatId: card.staffId,
      seatName: card.seatName,
      seatColor: card.seatColor,
      position: card.pos,
      etaMinutes: card.etaMinutes,
    };
  }
  const { data: row } = await supabase
    .from('queue_entry')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', entryId)
    .maybeSingle();
  if (!row) throw Errors.notFound('Queue entry not found');
  return {
    id: row.id,
    name: row.customer_name,
    initials: initials(row.customer_name),
    status: row.status,
    service: row.service_name,
    source: row.source,
    sourceLabel: row.source === 'online' ? 'Booked online' : 'Walk-in',
    seatId: row.staff_id,
    seatName: null,
    position: null,
    etaMinutes: 0,
  };
}

// ---------- Realtime fan-out (after every mutation) ----------
export async function broadcastQueue(businessId: string): Promise<void> {
  const ctx = await loadQueueContext(businessId);
  const groups = buildSeatGroups(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const summary = summarize(ctx);

  emitToOwners(businessId, 'queue:snapshot', { seats: groups.map(seatToDTO), summary });

  const clears = groups.map((g) => g.clearMinutes);
  const waitMinutes = clears.length ? Math.min(...clears) : 0;
  emitToPublic(businessId, 'availability:updated', { waitMinutes, queueCount: summary.waitingCount });

  await processTicketBroadcasts(businessId, ctx);
}

async function processTicketBroadcasts(businessId: string, ctx: QueueContext): Promise<void> {
  for (const entry of ctx.entries) {
    const pos = ticketPosition(entry.id, ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
    const isYourTurn = pos.status === 'in_service';
    emitToTicket(entry.id, 'ticket:updated', {
      ahead: pos.ahead,
      waitMinutes: pos.waitMinutes,
      status: pos.status,
      isYourTurn,
      progressPct: isYourTurn ? 100 : undefined,
    });

    // "It's your turn!" — once per ticket.
    if (isYourTurn && !entry.notified_turn_at) {
      await supabase.from('queue_entry').update({ notified_turn_at: new Date().toISOString() }).eq('id', entry.id);
      emitToTicket(entry.id, 'ticket:ready', { token: entry.token });
      await recordNotification(businessId, entry, 'your_turn', "It's your turn — please head in.");
      continue;
    }

    // "2 away" — once per ticket.
    if (
      pos.status === 'waiting' &&
      pos.ahead <= env.TWO_AWAY_THRESHOLD &&
      pos.ahead > 0 &&
      !entry.notified_two_away_at &&
      entry.customer_phone
    ) {
      await supabase
        .from('queue_entry')
        .update({ notified_two_away_at: new Date().toISOString() })
        .eq('id', entry.id);
      emitToTicket(entry.id, 'ticket:two_away', { ahead: pos.ahead });
      await recordNotification(businessId, entry, 'two_away', `You're ${pos.ahead} away — almost your turn.`);
    }
  }
}

/** Persists an outbound notification. SMS dispatch is DEFERRED (SMS_ENABLED=false). */
async function recordNotification(businessId: string, entry: any, template: string, body: string): Promise<void> {
  await supabase.from('notification').insert({
    business_id: businessId,
    queue_entry_id: entry.id,
    channel: env.SMS_ENABLED && entry.customer_phone ? 'sms' : 'in_app',
    template,
    to_address: entry.customer_phone,
    body,
    status: 'queued',
  });
  // When SMS_ENABLED becomes true, enqueue the sms.dispatch job here.
}

// ---------- Mutations ----------
export interface AddWalkInInput {
  name: string;
  phone?: string | null;
  serviceId?: string | null;
  staffId: string; // 'auto' | staff id
  position: 'end' | 'next';
}

export async function addWalkIn(businessId: string, input: AddWalkInInput) {
  const ctx = await loadQueueContext(businessId);
  let staffId = input.staffId;
  if (staffId === 'auto') {
    staffId = soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  }
  if (!ctx.staffRows.find((s) => s.id === staffId)) throw Errors.notFound('Seat not found');
  if (input.serviceId && !ctx.serviceRows.find((s) => s.id === input.serviceId)) {
    throw Errors.notFound('Service not found');
  }

  const phone = input.phone ? normalizePhone(input.phone) : null;
  const customerId = await findOrCreateCustomer(businessId, input.name, phone);

  const result = await callRpc<{ id: string; token: string; staff_id: string }>('queue_add', {
    p_business_id: businessId,
    p_name: input.name,
    p_phone: phone,
    p_service_id: input.serviceId ?? null,
    p_staff_id: staffId,
    p_position: input.position,
    p_source: 'walk_in',
    p_preferred_staff_id: null,
    p_appointment_id: null,
    p_customer_id: customerId,
  });

  emitToOwners(businessId, 'queue:entry.created', { entryId: result.id, seatId: staffId, source: 'walk_in' });
  await broadcastQueue(businessId);
  const entry = await getEntryDetail(businessId, result.id);
  const view = await getQueueView(businessId, { view: 'grouped' });
  return { entry, token: result.token, ...view };
}

async function mutateAndReturn(
  businessId: string,
  event: string,
  rpcResult: any,
  extra: Record<string, unknown> = {},
) {
  emitToOwners(businessId, event, { ...rpcResult, ...extra });
  await broadcastQueue(businessId);
  return getQueueView(businessId, { view: 'grouped' });
}

export async function startService(businessId: string, entryId: string) {
  const r = await callRpc('queue_start', { p_business_id: businessId, p_entry_id: entryId });
  return mutateAndReturn(businessId, 'queue:entry.started', { entryId, seatId: r.staff_id });
}

export async function checkout(businessId: string, entryId: string) {
  const r = await callRpc('queue_checkout', { p_business_id: businessId, p_entry_id: entryId });
  emitToOwners(businessId, 'queue:entry.completed', {
    entryId,
    seatId: r.staff_id,
    promoted: r.promoted,
    visitId: r.visit_id,
  });
  await broadcastQueue(businessId);
  const view = await getQueueView(businessId, { view: 'grouped' });
  return { promoted: r.promoted, ...view };
}

export async function noShow(businessId: string, entryId: string) {
  const r = await callRpc('queue_no_show', { p_business_id: businessId, p_entry_id: entryId });
  return mutateAndReturn(businessId, 'queue:entry.no_show', { entryId, seatId: r.staff_id });
}

export async function reassign(businessId: string, entryId: string, staffId: string) {
  const r = await callRpc('queue_reassign', {
    p_business_id: businessId,
    p_entry_id: entryId,
    p_staff_id: staffId,
  });
  return mutateAndReturn(businessId, 'queue:entry.reassigned', {
    entryId,
    fromSeatId: r.from_staff_id,
    toSeatId: r.to_staff_id,
  });
}

export async function extendService(businessId: string, entryId: string, label: string, minutes: number) {
  const known = SERVICE_EXTRAS.find((e) => e.label.toLowerCase() === label.toLowerCase());
  const price = known?.pricePaise ?? 0;
  const r = await callRpc('queue_extend', {
    p_business_id: businessId,
    p_entry_id: entryId,
    p_label: label,
    p_minutes: minutes,
    p_price: price,
  });
  return mutateAndReturn(businessId, 'queue:entry.extended', {
    entryId,
    label,
    minutes,
    newServiceName: r.service_name,
  });
}

export async function moveWithinSeat(businessId: string, entryId: string, toIndex: number) {
  const r = await callRpc('queue_move', { p_business_id: businessId, p_entry_id: entryId, p_to_index: toIndex });
  return mutateAndReturn(businessId, 'queue:entry.moved', { seatId: r.staff_id, order: r.order });
}

export async function cancelEntry(businessId: string, entryId: string) {
  const r = await callRpc('queue_leave', { p_business_id: businessId, p_entry_id: entryId });
  return mutateAndReturn(businessId, 'queue:entry.removed', { entryId, seatId: r.staff_id });
}
