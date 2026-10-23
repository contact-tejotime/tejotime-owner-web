import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { exec } from '../../db/pool';

/**
 * Meta WhatsApp Cloud API webhook (docs/whatsapp-india.md). Two jobs:
 *
 *   - statuses[] → move our `notification` row on: Meta's send response only means "accepted", so
 *     "delivered" and "failed" (a number not on WhatsApp, a marketing limit, …) arrive only here.
 *   - messages[] → honour STOP. Meta requires opt-out requests to be honoured; until this existed
 *     nothing ever set customer.sms_opt_out_at.
 *
 * Gated by its own secrets, not by WHATSAPP_ENABLED, so Meta's verification handshake can be done
 * before sending is switched on. Unsigned or wrongly signed POSTs are refused before any of this
 * runs: the endpoint is public, and a forged STOP would silence a customer.
 */

/** Meta's GET handshake: echo hub.challenge when the verify token matches, else null (→ 403). */
export function whatsappHandshake(query: Record<string, unknown>): string | null {
  const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return null;
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
  return safeEqual(token, expected) ? challenge : null;
}

/** X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(raw body, app secret), lowercase hex. */
export function isValidWhatsAppSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const secret = env.WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(m[1].toLowerCase(), expected);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The words Twilio's Advanced Opt-Out treats as STOP, so a customer who has both channels gets the
 * same rule; "stop promotions" is the label of the opt-out button Meta adds to marketing templates.
 */
const STOP_WORDS = new Set(['stop', 'stop all', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stop promotions']);

export function isStopMessage(text: string | null | undefined): boolean {
  return STOP_WORDS.has((text ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
}

interface WaStatus {
  id?: string;
  status?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

interface WaMessage {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string } };
}

interface WaPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: { statuses?: WaStatus[]; messages?: WaMessage[] } }[] }[];
}

/** The text a customer sent, from a typed message or a tapped (quick-reply) button. */
function messageText(m: WaMessage): string | null {
  if (m.type === 'text') return m.text?.body ?? null;
  if (m.type === 'button') return m.button?.text ?? m.button?.payload ?? null;
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? null;
  return null;
}

/**
 * Applies one delivery status. Meta does not promise order (a "delivered" can land before its
 * "sent"), so a row only ever moves forward: queued → sent → delivered, and failed is final.
 * "read" has no value of its own in notification_status; it is a delivered message.
 */
async function applyStatus(s: WaStatus): Promise<void> {
  if (!s.id || !s.status) return;
  if (s.status === 'sent') {
    await exec(
      `update notification set status = 'sent', sent_at = coalesce(sent_at, now())
        where provider_message_id = $1 and channel = 'whatsapp' and status = 'queued'`,
      [s.id],
    );
  } else if (s.status === 'delivered' || s.status === 'read') {
    await exec(
      `update notification set status = 'delivered'
        where provider_message_id = $1 and channel = 'whatsapp' and status in ('queued', 'sent')`,
      [s.id],
    );
  } else if (s.status === 'failed') {
    const e = s.errors?.[0];
    const error = e ? `${e.code ?? 'unknown'}: ${e.title ?? e.message ?? 'failed'}` : 'failed';
    await exec(
      `update notification set status = 'failed', error = $2
        where provider_message_id = $1 and channel = 'whatsapp'`,
      [s.id, error.slice(0, 500)],
    );
  }
}

/**
 * STOP from a number opts it out at every store, the same as Twilio's Advanced Opt-Out on the one
 * shared sender: the customer messaged TejoTime's number, not a store's. Ticking the website box
 * again is still a fresh consent (customer.repo.ts clears the stamp).
 */
async function applyOptOut(from: string): Promise<void> {
  const digits = from.replace(/\D/g, '');
  if (!digits) return;
  const count = await exec(
    `update customer set sms_opt_out_at = now(), updated_at = now()
      where phone = $1 and sms_opt_out_at is null`,
    [`+${digits}`],
  );
  logger.info({ optedOut: count }, 'WhatsApp STOP recorded');
}

/** Never throws for a bad item: Meta retries the whole delivery on anything but a 200. */
export async function handleWhatsAppWebhook(payload: unknown): Promise<void> {
  const body = (payload ?? {}) as WaPayload;
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      for (const s of value.statuses ?? []) {
        try {
          await applyStatus(s);
        } catch (err) {
          logger.warn({ err, status: s.status }, 'WhatsApp status update failed');
        }
      }
      for (const m of value.messages ?? []) {
        if (!m.from || !isStopMessage(messageText(m))) continue;
        try {
          await applyOptOut(m.from);
        } catch (err) {
          logger.warn({ err }, 'WhatsApp STOP could not be recorded');
        }
      }
    }
  }
}
