import { exec, many, one } from '../../db/pool';
import { money } from '../../domain/money';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { SERVICE_EXTRAS, OPTIONAL_SERVICES_STAFF_CATEGORIES, VISITOR_TYPE_CATEGORIES } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { initials } from '../../lib/format';
import { shouldNotifyEta15 } from '../../lib/eta-notify';
import {
  buildSeatGroups,
  flatCards,
  soonestSeat,
  ticketPosition,
  CardVM,
  SeatGroupVM,
} from '../../lib/queue-engine';
import { emitToOwners, emitToPublic, emitToTicket } from '../../realtime/emitters';
import { whatsappSender } from '../../integrations/whatsapp';
import { findOrCreateCustomer } from '../customers/customer.repo';
import { loadQueueContext, QueueContext, RawEntry } from './queue.context';

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
    visitorType: c.visitorType,
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

/**
 * What this entry would be charged if it were checked out right now.
 *
 * The same sum `queue_checkout` computes — booked service plus recorded add-ons — surfaced so
 * the checkout screen can PRE-FILL its amount box instead of making someone recall the price
 * list. They adjust it when the customer had extras that were never entered as add-ons, which
 * is the whole reason the override exists.
 */
async function billingFor(businessId: string, entryId: string) {
  const row = await one<{ service_paise: string; extras_paise: string; currency: string }>(
    `select coalesce(sv.price_paise, 0)                                    as service_paise,
            coalesce((select sum(x.price_paise)
                        from queue_entry_extra x
                       where x.queue_entry_id = q.id), 0)                  as extras_paise,
            b.currency
       from queue_entry q
       join business b on b.id = q.business_id
       left join service sv on sv.id = q.service_id
      where q.id = $1 and q.business_id = $2`,
    [entryId, businessId],
  );
  const service = Number(row?.service_paise ?? 0);
  const extras = Number(row?.extras_paise ?? 0);
  const currency = row?.currency;
  return {
    serviceAmount: money(service, currency),
    extrasAmount: money(extras, currency),
    suggestedAmount: money(service + extras, currency),
  };
}

/** The add-ons already recorded against an entry, so the checkout sheet can itemise them. */
async function extrasFor(entryId: string) {
  const rows = await many<{ id: string; label: string; minutes: number; price_paise: number }>(
    'select id, label, minutes, price_paise from queue_entry_extra where queue_entry_id = $1 order by created_at',
    [entryId],
  );
  return rows.map((r) => ({ id: r.id, label: r.label, minutes: r.minutes, pricePaise: r.price_paise }));
}

export async function getEntryDetail(businessId: string, entryId: string) {
  const ctx = await loadQueueContext(businessId);
  const groups = buildSeatGroups(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const card = flatCards(groups).find((c) => c.id === entryId);
  const [billing, extras] = await Promise.all([
    billingFor(businessId, entryId),
    extrasFor(entryId),
  ]);
  if (card) {
    return {
      ...billing,
      extras,
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
      visitorType: card.visitorType,
    };
  }
  const row = await one('select * from queue_entry where business_id = $1 and id = $2', [businessId, entryId]);
  if (!row) throw Errors.notFound('Queue entry not found');
  return {
    ...billing,
    extras,
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
    visitorType: row.visitor_type ?? null,
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

  // Per-barber live availability (drives the microsite "Our team" cards). Same
  // shape as GET /public/businesses/:slug/staff, so the client reuses it directly.
  const staff = ctx.staffRows.map((s) => {
    const g = groups.find((x) => x.id === s.id);
    return {
      id: s.id,
      name: s.name,
      roleLabel: s.role_label,
      busy: !!g?.serving,
      queueCount: g?.waitingCount ?? 0,
      waitMinutes: g?.clearMinutes ?? 0,
      waitLabel: g && g.clearMinutes > 0 ? `~${g.clearMinutes}m` : 'Free',
    };
  });
  emitToPublic(businessId, 'staff:availability', { staff });

  await processTicketBroadcasts(businessId, ctx);
}

async function processTicketBroadcasts(businessId: string, ctx: QueueContext): Promise<void> {
  for (const entry of ctx.entries) {
    const pos = ticketPosition(entry.id, ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
    const isYourTurn = pos.status === 'in_service';
    emitToTicket(entry.id, 'ticket:updated', {
      ahead: pos.ahead,
      waitMinutes: pos.waitMinutes,
      serviceRemainingMinutes: pos.serviceRemainingMinutes,
      status: pos.status,
      isYourTurn,
      progressPct: isYourTurn ? 100 : undefined,
    });

    // "It's your turn!" — once per ticket.
    if (isYourTurn && !entry.notified_turn_at) {
      const claimed = await claimNotifyStamp(entry.id, 'notified_turn_at');
      if (claimed) {
        emitToTicket(entry.id, 'ticket:ready', { token: entry.token });
        await recordAlertNotification(businessId, entry, 'your_turn', "It's your turn — please head in.");
      }
      continue;
    }

    // ~15-minute ETA window — once per online live-queue ticket (not walk-ins / appointments).
    if (
      shouldNotifyEta15({
        source: entry.source,
        appointmentId: entry.appointment_id,
        status: pos.status,
        waitMinutes: pos.waitMinutes,
        notifiedEta15At: entry.notified_eta_15_at,
        customerPhone: entry.customer_phone,
        thresholdMinutes: env.ETA_NOTIFY_MINUTES,
      })
    ) {
      const claimed = await claimNotifyStamp(entry.id, 'notified_eta_15_at');
      if (claimed) {
        emitToTicket(entry.id, 'ticket:eta_15', {
          waitMinutes: pos.waitMinutes,
          thresholdMinutes: env.ETA_NOTIFY_MINUTES,
        });
        const body = `You're about ${pos.waitMinutes} minutes away — almost your turn.`;
        await recordAlertNotification(businessId, entry, env.WHATSAPP_TEMPLATE_ETA_15 || 'eta_15', body);
      }
    }
  }
}

/**
 * Conditional claim: only one concurrent caller wins. Returns true if this caller
 * stamped the column (and should therefore send the notification).
 */
async function claimNotifyStamp(
  entryId: string,
  column: 'notified_turn_at' | 'notified_eta_15_at',
): Promise<boolean> {
  // `column` is a narrow union, never caller-supplied — safe to inline.
  const stamped = await exec(
    `update queue_entry set ${column} = $1 where id = $2 and ${column} is null`,
    [new Date().toISOString(), entryId],
  );
  return stamped > 0;
}

/** Persists an outbound alert and dispatches via the existing Twilio test-number path. */
async function recordAlertNotification(
  businessId: string,
  entry: RawEntry,
  template: string,
  body: string,
): Promise<void> {
  const hasPhone = !!entry.customer_phone;
  const channel = hasPhone ? 'whatsapp' : 'in_app';

  // Notification bookkeeping must never break the mutation that triggered it,
  // so a failed insert is swallowed exactly as the previous client's error
  // return value was.
  let row: { id: string } | null = null;
  try {
    row = await one<{ id: string }>(
      `insert into notification
         (business_id, queue_entry_id, channel, template, to_address, body, status, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        businessId,
        entry.id,
        channel,
        template,
        entry.customer_phone,
        body,
        hasPhone ? 'queued' : 'sent',
        hasPhone ? null : new Date().toISOString(),
      ],
    );
  } catch {
    return;
  }

  if (!row?.id || !entry.customer_phone) return;

  const result = await whatsappSender.send(entry.customer_phone, body, template);
  await exec(
    `update notification
        set status = $1, provider_message_id = $2, sent_at = $3, error = $4
      where id = $5`,
    [
      result.id ? 'sent' : 'failed',
      result.id,
      result.id ? new Date().toISOString() : null,
      result.id ? null : 'Twilio send failed or deferred',
      row.id,
    ],
  );
}

// ---------- Mutations ----------
export interface AddWalkInInput {
  name: string;
  phone?: string | null;
  serviceId?: string | null;
  staffId: string; // 'auto' | staff id
  position: 'end' | 'next';
  visitorType?: 'mr' | 'patient' | null;
}

export async function addWalkIn(businessId: string, input: AddWalkInInput) {
  const ctx = await loadQueueContext(businessId);
  const biz = await one('select category from business where id = $1', [businessId]);
  const category = biz?.category ?? '';
  if (!OPTIONAL_SERVICES_STAFF_CATEGORIES.has(category) && !input.serviceId) {
    throw Errors.validation('Add a service', [{ field: 'serviceId', message: 'Pick a service' }]);
  }
  if (VISITOR_TYPE_CATEGORIES.has(category) && !input.visitorType) {
    throw Errors.validation('Visitor type is required', [{ field: 'visitorType', message: 'Pick MR or Patient' }]);
  }

  let staffId: string | null = input.staffId;
  if (staffId === 'auto') {
    staffId = soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  }
  if (ctx.staffRows.length === 0) {
    // No staff configured for this business at all (e.g. a Hospital that doesn't track
    // doctors as "staff") — the seat concept doesn't apply, so skip it entirely.
    staffId = null;
  } else if (!ctx.staffRows.find((s) => s.id === staffId)) {
    throw Errors.notFound('Seat not found');
  }
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
    p_visitor_type: input.visitorType ?? null,
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

/**
 * Complete a service. `amountPaise` overrides the derived total for the visit that gets
 * written; omit it and the service + add-ons sum is used, exactly as before.
 */
export async function checkout(businessId: string, entryId: string, amountPaise?: number | null) {
  const r = await callRpc('queue_checkout', {
    p_business_id: businessId,
    p_entry_id: entryId,
    p_amount_paise: amountPaise ?? null,
  });
  emitToOwners(businessId, 'queue:entry.completed', {
    entryId,
    seatId: r.staff_id,
    promoted: r.promoted,
    visitId: r.visit_id,
  });
  // The finished entry drops out of the active set, so broadcastQueue can no
  // longer reach its ticket room — push the terminal event directly here.
  emitToTicket(entryId, 'ticket:completed', { visitId: r.visit_id });
  await broadcastQueue(businessId);
  const view = await getQueueView(businessId, { view: 'grouped' });
  return { promoted: r.promoted, ...view };
}

export async function noShow(businessId: string, entryId: string) {
  const r = await callRpc('queue_no_show', { p_business_id: businessId, p_entry_id: entryId });
  // Terminal push to the now-inactive entry's ticket room (broadcastQueue skips it).
  emitToTicket(entryId, 'ticket:cancelled', { reason: 'no_show' });
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
  // Terminal push to the now-inactive entry's ticket room (broadcastQueue skips it).
  emitToTicket(entryId, 'ticket:cancelled', { reason: 'removed' });
  return mutateAndReturn(businessId, 'queue:entry.removed', { entryId, seatId: r.staff_id });
}
