import cron from 'node-cron';
import { supabase } from '../db/supabase';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { broadcastQueue } from '../modules/queue/queue.service';

/**
 * In-process scheduled jobs (single instance). Swap for BullMQ + Redis workers
 * when scaling — see docs/09-background-jobs.md. Reminder/SMS/email dispatch and
 * subscription-provider sync are DEFERRED until credentials are provided.
 */

/** Cancel abandoned waiting tickets older than TICKET_ABANDON_HOURS. */
async function staleCleanup() {
  const cutoff = new Date(Date.now() - env.TICKET_ABANDON_HOURS * 3_600_000).toISOString();
  const { data } = await supabase
    .from('queue_entry')
    .select('id, business_id')
    .eq('status', 'waiting')
    .lt('joined_at', cutoff);
  if (!data?.length) return;

  const ids = data.map((r) => r.id);
  await supabase
    .from('queue_entry')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', ids);

  const businessIds = [...new Set(data.map((r) => r.business_id))];
  for (const bid of businessIds) await broadcastQueue(bid);
  logger.info({ count: ids.length }, 'Stale tickets cleaned up');
}

async function purgeOtp() {
  await supabase.from('otp_verification').delete().lt('expires_at', new Date().toISOString());
}

async function purgeSessions() {
  await supabase.from('auth_session').delete().lt('expires_at', new Date().toISOString());
}

export function startScheduler(): void {
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
  logger.info('Scheduler started (stale-cleanup, otp-purge, session-purge)');
}
