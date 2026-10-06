import { exec, many, one } from '../../db/pool';
import { money, servicePricing } from '../../domain/money';
import { callRpc } from '../../db/rpc';
import { SERVICE_EXTRAS, VISITOR_TYPE_CATEGORIES } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { initials } from '../../lib/format';
import { shouldNotifyEta } from '../../lib/eta-notify';
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
import { sendReviewRequest } from '../notifications/sms-dispatch';
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
  // Summary must match the seats the caller actually sees — a staff login's filtered chair,
  // not the whole shop (otherwise the header says "6 waiting · 3 seats" while the board shows one).
  const summary = {
    seatCount: filtered.length,
    activeCount: filtered.reduce((n, g) => n + g.cards.length, 0),
    waitingCount: filtered.reduce((n, g) => n + g.waitingCount, 0),
  };
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
  const row = await one<{
    service_paise: string;
    service_max_paise: string | null;
    service_price_type: string | null;
    service_name: string | null;
    extras_paise: string;
    currency: string;
  }>(
    `select coalesce(sv.price_paise, 0)                                    as service_paise,
            sv.price_max_paise                                             as service_max_paise,
            sv.price_type                                                  as service_price_type,
            sv.name                                                        as service_name,
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
  // An entry with no service at all (a bare walk-in) has nothing to derive a charge from. It used
  // to fall through to the add-ons total — usually 0 — and bank a free visit into `visit` and the
  // customer's spend. Now that a store may list no services, that would be the common case, so
  // it is treated like an unpriced service: whoever checks it out types the amount. Add-ons
  // recorded against it still count as a basis, so that flow is unchanged.
  const noPriceBasis = !row?.service_price_type && extras === 0;
  const pricing = row?.service_price_type
    ? servicePricing(
        {
          price_type: row.service_price_type,
          price_paise: service,
          price_max_paise: row.service_max_paise,
        },
        currency,
      )
    : null;
  const amountRequired = noPriceBasis || (pricing?.amountRequired ?? false);
  return {
    // The booked service on its own. `queue_entry.service_name` carries every add-on too
    // ("Hair cut + Hair wash + Blow-dry"), so a sheet that asks for the price of an unpriced
    // service needs this to name the one thing it is asking about.
    serviceName: row?.service_name ?? null,
    serviceAmount: money(service, currency),
    // The band the shop published, so the checkout sheet can show what it promised the
    // customer next to the box it is asking someone to fill in.
    // A no-service entry reports `unset` so both owner surfaces word it like an unpriced service
    // ("Price on request" + the type-an-amount hint) rather than a misleading "₹0".
    servicePriceType: noPriceBasis ? 'unset' : (pricing?.priceType ?? 'fixed'),
    serviceMaxAmount: pricing?.priceMax ?? null,
    extrasAmount: money(extras, currency),
    /**
     * What to pre-fill. Null for a range or an unpriced service: there is no defensible figure
     * to put in the box, and pre-filling the floor is precisely how the minimum ends up banked
     * as the day's takings. `queue_checkout` refuses a null amount for these too, so the
     * requirement holds even for a client that ignores this.
     */
    suggestedAmount: amountRequired ? null : money(service + extras, currency),
    amountRequired,
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

/** Wait-minute thresholds for the ticket ETA socket events. */
const ETA_NOTIFY_15_MINUTES = 15;
const ETA_NOTIFY_2_MINUTES = 2;

/**
 * Per-ticket socket pushes. These used to double as the waitlist SMS (joined / ~15 / ~2 / your
 * turn); that set was replaced by the three appointment texts in modules/notifications/sms-dispatch.ts
 * (docs/sms-opt-in-a2p.md), so nothing here calls Twilio any more — the one-shot claims remain so
 * each socket event still fires once per ticket.
 */
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
      }
      continue;
    }

    const etaBase = {
      source: entry.source,
      status: pos.status,
      waitMinutes: pos.waitMinutes,
      customerPhone: entry.customer_phone,
      smsOptIn: entry.sms_opt_in === true,
    };

    // ~15-minute ETA window — once per online queue ticket.
    if (
      shouldNotifyEta({
        ...etaBase,
        notifiedAt: entry.notified_eta_15_at,
        thresholdMinutes: ETA_NOTIFY_15_MINUTES,
      })
    ) {
      const claimed = await claimNotifyStamp(entry.id, 'notified_eta_15_at');
      if (claimed) {
        emitToTicket(entry.id, 'ticket:eta_15', {
          waitMinutes: pos.waitMinutes,
          thresholdMinutes: ETA_NOTIFY_15_MINUTES,
        });
      }
    }

    // ~2-minute ETA window — once per online queue ticket.
    if (
      shouldNotifyEta({
        ...etaBase,
        notifiedAt: entry.notified_eta_2_at,
        thresholdMinutes: ETA_NOTIFY_2_MINUTES,
      })
    ) {
      const claimed = await claimNotifyStamp(entry.id, 'notified_eta_2_at');
      if (claimed) {
        emitToTicket(entry.id, 'ticket:eta_2', {
          waitMinutes: pos.waitMinutes,
          thresholdMinutes: ETA_NOTIFY_2_MINUTES,
        });
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
  column: 'notified_turn_at' | 'notified_eta_15_at' | 'notified_eta_2_at',
): Promise<boolean> {
  // `column` is a narrow union, never caller-supplied — safe to inline.
  const stamped = await exec(
    `update queue_entry set ${column} = $1 where id = $2 and ${column} is null`,
    [new Date().toISOString(), entryId],
  );
  return stamped > 0;
}

// ---------- Mutations ----------
export interface AddWalkInInput {
  name: string;
  phone?: string | null;
  /** Single-service form every already-shipped client sends. Folded into `serviceIds`. */
  serviceId?: string | null;
  /** The visit's services in pick order; the first becomes the entry's primary service. */
  serviceIds?: string[] | null;
  staffId: string; // 'auto' | staff id
  position: 'end' | 'next';
  visitorType?: 'mr' | 'patient' | null;
}

export async function addWalkIn(businessId: string, input: AddWalkInInput) {
  const ctx = await loadQueueContext(businessId);
  const biz = await one('select category from business where id = $1', [businessId]);
  const category = biz?.category ?? '';
  // Pick order matters — the first choice becomes the primary service, the rest become extras.
  const pickedIds: string[] = [];
  for (const id of [...(input.serviceIds ?? []), ...(input.serviceId ? [input.serviceId] : [])]) {
    if (id && !pickedIds.includes(id)) pickedIds.push(id);
  }
  // No service is required: a store collects as little as it can, so a walk-in may be added
  // bare. `billingFor` then makes whoever checks it out type the amount.
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
  // Resolved in pick order. An unknown id is refused rather than dropped: silently queueing a
  // shorter, cheaper visit than the one that was rung up is the failure this guards.
  const picked = pickedIds.map((id) => {
    const row = ctx.serviceRows.find((s) => s.id === id);
    if (!row) throw Errors.notFound('Service not found');
    return row;
  });

  const phone = input.phone ? normalizePhone(input.phone) : null;
  const customerId = await findOrCreateCustomer(businessId, input.name, phone);

  const result = await callRpc<{ id: string; token: string; staff_id: string }>('queue_add', {
    p_business_id: businessId,
    p_name: input.name,
    p_phone: phone,
    p_service_id: picked[0]?.id ?? null,
    p_staff_id: staffId,
    p_position: input.position,
    p_source: 'walk_in',
    p_preferred_staff_id: null,
    p_appointment_id: null,
    p_customer_id: customerId,
    p_visitor_type: input.visitorType ?? null,
  });

  // Services 2..n become the entry's extras — `extra_minutes` for the wait-time engine and
  // `queue_entry_extra` rows for the checkout total (migration 0025). Before the broadcast, so
  // the board never flashes the entry up as a bare first service.
  if (picked.length > 1) {
    await callRpc('queue_attach_services', {
      p_business_id: businessId,
      p_entry_id: result.id,
      p_services: JSON.stringify(
        picked.slice(1).map((sv) => ({ name: sv.name, minutes: sv.duration_minutes, price: sv.price_paise })),
      ),
    });
  }

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
  // After the commit, and only for a visit whose customer ticked the separate review box.
  // Never lets a Twilio/DB hiccup fail a checkout that has already been written.
  await sendReviewRequest(businessId, entryId).catch(() => undefined);
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

export async function extendService(
  businessId: string,
  entryId: string,
  label: string,
  minutes: number,
  pricePaise?: number,
) {
  // The owner's own figure wins. The catalog price is only a fallback for app builds that send
  // none: it is one platform-wide number per label (a shave is ₹50 in every store), which is why
  // the chips now ask.
  const known = SERVICE_EXTRAS.find((e) => e.label.toLowerCase() === label.toLowerCase());
  const price = pricePaise ?? known?.pricePaise ?? 0;
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

/** Take an add-on back off an in-service entry — a tap on a highlighted chip (0039). */
export async function removeExtra(businessId: string, entryId: string, label: string) {
  const r = await callRpc('queue_remove_extra', {
    p_business_id: businessId,
    p_entry_id: entryId,
    p_label: label,
  });
  return mutateAndReturn(businessId, 'queue:entry.extra_removed', {
    entryId,
    label,
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
