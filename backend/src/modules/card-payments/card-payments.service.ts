import { many, one, transaction } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { isUsStore } from '../../domain/enums';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { emitToOwners } from '../../realtime/emitters';
import { afterCheckout, broadcastQueue, getQueueView } from '../queue/queue.service';

/**
 * Card payments on a PayPal POS Card Reader (docs/card-payments-paypal.md).
 *
 * PayPal's reader can only be driven by its native SDK on a phone, so the MAIN owner's phone
 * charges the card and this module records it:
 *
 *   start    → a `pending` row; its id is the reference the phone hands to the reader
 *   complete → the reader approved: `paid`, and the visit is completed with it (one transaction)
 *   fail     → declined, cancelled, or an unconfirmed attempt the owner gave up on
 *   refund   → the reader refunded the whole amount: the visit leaves revenue and commission
 *
 * The amounts and card details come from the owner's own phone; nothing here can check them with
 * PayPal. That is the same trust as the amount box at every checkout, and only the main owner —
 * the merchant whose PayPal account takes the money — can call any of it.
 *
 * US stores only (`isUsStore`, client decision 2026-10-15): turning it on, and starting a charge,
 * are refused with 409 CARD_PAYMENTS_US_ONLY anywhere else. Completing, failing and refunding are
 * not — money already moved is always recorded.
 */

interface CardPaymentRow {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  amount_paise: string;
  charged_amount_paise: string | null;
  tip_paise: string | null;
  currency: string;
  needs_review: boolean;
  card_brand: string | null;
  card_last4: string | null;
  entry_mode: string | null;
  failure_reason: string | null;
  queue_entry_id: string | null;
  visit_id: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  customer_name?: string | null;
  service_name?: string | null;
}

function toDTO(r: CardPaymentRow) {
  return {
    id: r.id,
    status: r.status,
    amount: money(Number(r.amount_paise), r.currency),
    chargedAmount: r.charged_amount_paise == null ? null : money(Number(r.charged_amount_paise), r.currency),
    // The tip inside `amount` (0046); 0 for a charge with none.
    tip: money(Number(r.tip_paise ?? 0), r.currency),
    // Paid, but its visit could not be completed with it (finished or cancelled meanwhile), or the
    // reader charged a different amount. The owner decides: refund it or keep it.
    needsReview: r.needs_review,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    entryMode: r.entry_mode,
    failureReason: r.failure_reason,
    queueEntryId: r.queue_entry_id,
    visitId: r.visit_id,
    customerName: r.customer_name ?? null,
    serviceName: r.service_name ?? null,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    refundedAt: r.refunded_at,
  };
}

const SELECT_WITH_ENTRY = `
  select cp.*, q.customer_name, q.service_name
    from card_payment cp
    left join queue_entry q on q.id = cp.queue_entry_id and q.business_id = cp.business_id`;

async function getRow(businessId: string, id: string): Promise<CardPaymentRow> {
  const row = await one<CardPaymentRow>(`${SELECT_WITH_ENTRY} where cp.id = $1 and cp.business_id = $2`, [
    id,
    businessId,
  ]);
  if (!row) throw Errors.notFound('Card payment not found');
  return row;
}

/** Other phones showing this visit (owner-web, a co-owner) re-read it: Complete is blocked or freed. */
function announce(businessId: string, row: CardPaymentRow) {
  emitToOwners(businessId, 'card_payment:updated', {
    paymentId: row.id,
    entryId: row.queue_entry_id,
    visitId: row.visit_id,
    status: row.status,
  });
}

async function storeRow(businessId: string) {
  const b = await one<{ card_payments_enabled: boolean | null; paypal_org_ref: string | null; currency: string | null }>(
    'select card_payments_enabled, paypal_org_ref, currency from business where id = $1',
    [businessId],
  );
  if (!b) throw Errors.notFound('Business not found');
  return b;
}

/** Card payments are for US stores only (isUsStore, client decision 2026-10-15). */
function usOnly() {
  return Errors.conflict('CARD_PAYMENTS_US_ONLY', 'Card payments on the PayPal reader are for US stores only');
}

export async function getSettings(businessId: string) {
  const b = await storeRow(businessId);
  const available = isUsStore(b.currency);
  return {
    // Off for any store that is not a US store, whatever the column says (a currency changed
    // after card payments were turned on does not keep them on).
    enabled: available && b.card_payments_enabled === true,
    /** Whether this store can have card payments at all — US stores only. */
    available,
    paypalOrgRef: b.paypal_org_ref ?? null,
    currency: b.currency ?? null,
  };
}

export async function setSettings(businessId: string, enabled: boolean, paypalOrgRef?: string | null) {
  if (enabled && !isUsStore((await storeRow(businessId)).currency)) throw usOnly();
  // Turning off keeps the account reference: turning back on from the same phone needs no new
  // sign-in round trip to compare against.
  await one(
    `update business
        set card_payments_enabled = $2,
            paypal_org_ref = coalesce($3, paypal_org_ref),
            updated_at = now()
      where id = $1
      returning id`,
    [businessId, enabled, paypalOrgRef ?? null],
  );
  // Every open checkout sheet's Card rule changes with this.
  await broadcastQueue(businessId);
  return getSettings(businessId);
}

/**
 * "Sign out of PayPal" in the app: card payments off AND the store forgets its PayPal account, so
 * the owner can sign in with another one and turn them back on (setSettings saves that one). The
 * phone signs itself out of PayPal's SDK after this succeeds.
 *
 * Its own route rather than `PUT /settings` with `paypalOrgRef: null`: builds already on phones
 * send no account when switching off, and that has to keep meaning "keep the account".
 *
 * Refused while a charge is unconfirmed (`pending`, at any age): once the phone is signed out, or
 * signed in to another account, "Check with PayPal" can no longer find that charge to settle it.
 * card_payment_start takes the same lock and then re-reads the switch, so no charge can start
 * between this check and the update — it gets CARD_PAYMENTS_OFF instead.
 *
 * Not US-gated: a store whose currency changed must still be able to let go of its account.
 */
export async function disconnect(businessId: string) {
  await transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1::uuid::text))', [businessId]);
    const pending = await client.query(
      `select 1 from card_payment where business_id = $1 and status = 'pending' limit 1`,
      [businessId],
    );
    if (pending.rowCount) {
      throw Errors.conflict('CARD_PAYMENT_IN_PROGRESS', 'Settle the unconfirmed card payment first');
    }
    await client.query(
      `update business
          set card_payments_enabled = false,
              paypal_org_ref = null,
              updated_at = now()
        where id = $1`,
      [businessId],
    );
  });
  // After the commit, as every emit is: open checkout sheets stop asking "Paid by".
  await broadcastQueue(businessId);
  return getSettings(businessId);
}

/**
 * `amountPaise` is the whole charge (bill + tip); `tipPaise` is the tip inside it. The reader is
 * asked for the whole; completing the payment banks the bill and the tip separately (0046).
 */
export async function start(
  businessId: string,
  userId: string,
  entryId: string,
  amountPaise: number,
  tipPaise?: number | null,
) {
  // Before any money can move: a store that is no longer a US store cannot start a charge, even
  // with the flag still set from before its currency changed.
  if (!isUsStore((await storeRow(businessId)).currency)) throw usOnly();
  const r = await callRpc<{ id: string; resumed: boolean }>('card_payment_start', {
    p_business_id: businessId,
    p_entry_id: entryId,
    p_amount_paise: amountPaise,
    p_user_id: userId,
    p_tip_paise: tipPaise ?? 0,
  });
  const row = await getRow(businessId, r.id);
  announce(businessId, row);
  // `resumed`: this visit already had an attempt in flight. The phone checks the reader for that
  // reference before charging, so a charge that went through is finished rather than repeated.
  return { payment: toDTO(row), resumed: r.resumed === true };
}

export async function complete(
  businessId: string,
  id: string,
  input: {
    providerPaymentId?: string | null;
    cardBrand?: string | null;
    cardLast4?: string | null;
    entryMode?: string | null;
    chargedAmountPaise?: number | null;
  },
) {
  const r = await callRpc<{ already: boolean; checkout: any | null }>('card_payment_complete', {
    p_business_id: businessId,
    p_payment_id: id,
    p_provider_payment_id: input.providerPaymentId ?? null,
    p_card_brand: input.cardBrand ?? null,
    p_card_last4: input.cardLast4 ?? null,
    p_entry_mode: input.entryMode ?? null,
    p_charged_amount_paise: input.chargedAmountPaise ?? null,
  });
  const row = await getRow(businessId, id);
  if (r.checkout) {
    // The visit was completed with this card: exactly what a plain checkout sets off.
    announce(businessId, row);
    const done = await afterCheckout(businessId, r.checkout.id, r.checkout);
    return { payment: toDTO(row), ...done };
  }
  // A repeat (already recorded), or paid with no visit to complete (needs review): nothing else
  // changed on the board, but the caller still gets it.
  if (!r.already) {
    announce(businessId, row);
    await broadcastQueue(businessId);
  }
  const view = await getQueueView(businessId, { view: 'grouped' });
  return { payment: toDTO(row), promoted: null, ...view };
}

export async function fail(businessId: string, id: string, reason: string) {
  const updated = await one<{ id: string }>(
    `update card_payment set status = 'failed', failure_reason = $3
      where id = $1 and business_id = $2 and status = 'pending'
      returning id`,
    [id, businessId, reason],
  );
  const row = await getRow(businessId, id);
  // Already paid (the reader got there first) or already failed: nothing to change. Paid money is
  // never turned into a failure by a late cancel.
  if (updated) {
    announce(businessId, row);
    await broadcastQueue(businessId);
  }
  return { payment: toDTO(row) };
}

export async function refund(businessId: string, userId: string, id: string, refundReference?: string | null) {
  const r = await callRpc<{ already: boolean }>('card_payment_refund', {
    p_business_id: businessId,
    p_payment_id: id,
    p_user_id: userId,
    p_refund_reference: refundReference ?? null,
  });
  const row = await getRow(businessId, id);
  if (!r.already) announce(businessId, row);
  return { payment: toDTO(row) };
}

export async function list(
  businessId: string,
  query: { status?: CardPaymentRow['status']; needsReview?: boolean; limit: number },
) {
  const params: unknown[] = [businessId];
  let filter = '';
  if (query.status) {
    params.push(query.status);
    filter += ` and cp.status = $${params.length}`;
  }
  if (query.needsReview !== undefined) {
    params.push(query.needsReview);
    filter += ` and cp.needs_review = $${params.length}`;
  }
  params.push(query.limit);
  const rows = await many<CardPaymentRow>(
    `${SELECT_WITH_ENTRY}
      where cp.business_id = $1${filter}
      order by cp.created_at desc
      limit $${params.length}`,
    params,
  );
  return { data: rows.map(toDTO) };
}
