import cron from 'node-cron';
import { exec, many } from '../db/pool';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { broadcastQueue } from '../modules/queue/queue.service';

/**
 * In-process scheduled jobs (single instance). Swap for BullMQ + Redis workers
 * when scaling — see docs/09-background-jobs.md. Reminder/SMS/email/WhatsApp
 * provider sync are DEFERRED until credentials are provided.
 */

/**
 * Cancel abandoned tickets older than TICKET_ABANDON_HOURS. Covers in_service
 * too: an entry the owner never checked out would otherwise stay active forever
 * and permanently inflate the queue counts shown in the owner app and admin panel.
 */
async function staleCleanup() {
  const cutoff = new Date(Date.now() - env.TICKET_ABANDON_HOURS * 3_600_000).toISOString();
  const rows = await many(
    `select id, business_id from queue_entry
      where status in ('waiting', 'in_service') and joined_at < $1`,
    [cutoff],
  );
  if (!rows.length) return;

  const ids = rows.map((r) => r.id);
  await exec(`update queue_entry set status = 'cancelled', updated_at = $1 where id = any($2::uuid[])`, [
    new Date().toISOString(),
    ids,
  ]);

  const businessIds = [...new Set(rows.map((r) => r.business_id))];
  for (const bid of businessIds) await broadcastQueue(bid);
  logger.info({ count: ids.length }, 'Stale tickets cleaned up');
}

/**
 * Recompute ETA / fire the ~15-minute WhatsApp alert for businesses that have
 * waiting online live-queue entries. Needed because wall-clock decay of the
 * in-service chair can cross the threshold with no owner mutation.
 * Idempotent via notified_eta_15_at conditional claim inside broadcastQueue.
 */
export async function etaNotifySweep(): Promise<void> {
  const rows = await many(
    `select business_id from queue_entry
      where status = 'waiting'
        and source = 'online'
        and appointment_id is null
        and notified_eta_15_at is null
        and customer_phone is not null`,
  );
  if (!rows.length) return;

  const businessIds = [...new Set(rows.map((r) => r.business_id))];
  for (const bid of businessIds) {
    try {
      await broadcastQueue(bid);
    } catch (err) {
      logger.error({ err, businessId: bid }, 'etaNotifySweep broadcast failed');
    }
  }
  logger.debug({ businesses: businessIds.length }, 'ETA notify sweep completed');
}

async function purgeOtp() {
  await exec('delete from otp_verification where expires_at < $1', [new Date().toISOString()]);
}

async function purgeSessions() {
  await exec('delete from auth_session where expires_at < $1', [new Date().toISOString()]);
}

export function startScheduler(): void {
  // Every 60 seconds: recompute ETA alerts for active online queues (wall-clock decay).
  cron.schedule('* * * * *', () => {
    etaNotifySweep().catch((err) => logger.error({ err }, 'etaNotifySweep failed'));
  });
  // Every 15 minutes: stale ticket cleanup.
  cron.schedule('*/15 * * * *', () => {
    staleCleanup().catch((err) => logger.error({ err }, 'staleCleanup failed'));
  });
  // Every 30 minutes: purge expired OTPs.
  cron.schedule('*/30 * * * *', () => {
    purgeOtp().catch((err) => logger.error({ err }, 'purgeOtp failed'));
  });
  // Daily 00:10: purge expired sessions.
  cron.schedule('10 0 * * *', () => {
    purgeSessions().catch((err) => logger.error({ err }, 'purgeSessions failed'));
  });
  logger.info('Scheduler started (eta-notify-sweep, stale-cleanup, otp-purge, session-purge)');
}
