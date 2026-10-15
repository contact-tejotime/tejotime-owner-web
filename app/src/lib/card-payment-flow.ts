import { api, type CardChargeReport, type CardPayment } from '@/lib/api';
import { cardReader, isCardReaderAvailable, type ReaderChargeResult } from '@/lib/card-reader';

/**
 * The card-payment flows, end to end: the API records, the reader charges
 * (docs/card-payments-paypal.md). No React here — the store and the Card payments screen call
 * these and turn the outcome into state and toasts.
 *
 * The rule every branch keeps: ONCE THE READER HAS TAKEN MONEY, IT GETS RECORDED. A charge whose
 * result is lost (the app killed mid-charge, the network gone when it came back) is left `pending`
 * on the server — never marked failed — and `recoverPendingCardPayments` asks the reader about it
 * on the next launch. The server, for its part, never refuses a completed charge (0043).
 */

/** The card's brand and last four, and what was charged — never the card number. */
function reportOf(r: ReaderChargeResult): CardChargeReport {
  const last4 = (r.cardLast4 ?? '').trim();
  return {
    providerPaymentId: r.transactionId?.slice(0, 200) ?? null,
    cardBrand: r.cardBrand?.slice(0, 40) ?? null,
    cardLast4: /^\d{4}$/.test(last4) ? last4 : null,
    entryMode: r.entryMode?.slice(0, 40) ?? null,
    chargedAmountPaise: typeof r.amountMinor === 'number' ? Math.round(r.amountMinor) : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Record an approved card, retrying a few times: the money has moved, so a dropped connection is
 * worth waiting out. The API makes a repeat harmless (it returns what the first call wrote).
 */
async function completeWithRetry(id: string, report: CardChargeReport) {
  let lastError: unknown;
  for (const wait of [0, 1500, 4000]) {
    if (wait) await sleep(wait);
    try {
      return await api.completeCardPayment(id, report);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export type ChargeOutcome =
  /** Charged and recorded; the visit is complete. `res` is the board, like a checkout's. */
  | { kind: 'paid'; res: Awaited<ReturnType<typeof api.completeCardPayment>> }
  | { kind: 'declined'; reason: string | null }
  | { kind: 'canceled' }
  /**
   * The reader charged the card but TejoTime could not record it yet, or the phone could not tell
   * whether the card was charged at all. Left pending; recovery finishes it.
   */
  | { kind: 'unconfirmed' };

/**
 * Charge an in-service customer's card for the whole bill, and complete the visit with it.
 *
 * `amountPaise` is the checkout box (minor units, > 0). Tipping is always off: the reader charges
 * the final amount and nothing else (client decision 2026-10-15).
 */
export async function chargeVisit(entryId: string, amountPaise: number): Promise<ChargeOutcome> {
  const { payment, resumed } = await api.startCardPayment(entryId, amountPaise);

  // This visit already had an attempt in flight (a lost response, a crash). Before charging that
  // reference again, ask the reader whether it went through — charging twice is the one mistake
  // that costs the customer money.
  let result: ReaderChargeResult | null = null;
  if (resumed) {
    const prior = await cardReader.retrieve(payment.id).catch(() => null);
    if (!prior) return { kind: 'unconfirmed' };
    if (prior.status === 'completed') result = prior;
  }

  if (!result) {
    try {
      result = await cardReader.charge(amountPaise, payment.id);
    } catch {
      // The native side gave no answer at all: whether the card was charged is unknown. Leave
      // the attempt pending for recovery rather than call it failed.
      return { kind: 'unconfirmed' };
    }
  }

  if (result.status === 'completed') {
    try {
      return { kind: 'paid', res: await completeWithRetry(payment.id, reportOf(result)) };
    } catch {
      return { kind: 'unconfirmed' };
    }
  }

  // Declined or backed out of before the card was read: nothing was taken, so free the visit for
  // another method. If this write is lost, the 15-minute guard frees it anyway.
  const reason = result.status === 'canceled' ? 'Cancelled on the phone' : result.reason || 'Declined';
  await api.failCardPayment(payment.id, reason.slice(0, 200)).catch(() => undefined);
  return result.status === 'canceled' ? { kind: 'canceled' } : { kind: 'declined', reason: result.reason ?? null };
}

/**
 * On launch, on the main owner's phone: finish every attempt left `pending` — record the ones the
 * reader charged, fail the ones it never did. Returns how many it settled.
 *
 * An attempt younger than two minutes is left alone: it may be in progress on the owner's other
 * device (a phone and a front-desk iPad signed in to the same account).
 */
export async function recoverPendingCardPayments(): Promise<number> {
  if (!isCardReaderAvailable()) return 0;
  if (!(await cardReader.isLoggedIn().catch(() => false))) return 0;
  const { data } = await api.listCardPayments({ status: 'pending', limit: 20 });
  let settled = 0;
  for (const p of data) {
    if (Date.now() - new Date(p.createdAt).getTime() < 2 * 60_000) continue;
    const r = await cardReader.retrieve(p.id).catch(() => null);
    if (!r) continue;
    try {
      if (r.status === 'completed') {
        await api.completeCardPayment(p.id, reportOf(r));
        settled++;
      } else if (r.status === 'not_found' || r.status === 'failed') {
        await api.failCardPayment(p.id, 'Not charged (checked with PayPal)');
        settled++;
      }
    } catch {
      /* try again next launch */
    }
  }
  return settled;
}

/**
 * Refund a card payment — always the whole amount, back to the card (client decision 2026-10-15).
 * The reader refunds first; then TejoTime records it, which takes the visit out of revenue and
 * commission. The refund reference is fixed per payment, so a retry is the same refund to PayPal.
 */
export async function refundCardPayment(p: CardPayment): Promise<CardPayment> {
  const amount = (p.chargedAmount ?? p.amount).amount;
  const refundRef = `${p.id}:refund`;
  const r = await cardReader.refund(p.id, amount, refundRef);
  if (r.status === 'completed' || r.alreadyRefunded) {
    return (await api.refundCardPayment(p.id, r.transactionId ?? refundRef)).payment;
  }
  throw new RefundError(r.status === 'canceled' ? 'canceled' : 'failed', r.reason ?? null);
}

export class RefundError extends Error {
  constructor(
    readonly kind: 'canceled' | 'failed',
    readonly reason: string | null,
  ) {
    super(reason ?? kind);
  }
}
