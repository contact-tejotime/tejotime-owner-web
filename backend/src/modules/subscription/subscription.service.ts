import { exec, one } from '../../db/pool';
import { env } from '../../config/env';
import { PlanType } from '../../domain/enums';
import { emitToOwners } from '../../realtime/emitters';

/** Live plan lookup (authoritative) — used by plan-gated reads so an upgrade
 * takes effect immediately without waiting for a token refresh. */
export async function getLivePlan(businessId: string): Promise<PlanType> {
  const row = await one('select plan from subscription where business_id = $1', [businessId]);
  return (row?.plan as PlanType) ?? 'free';
}

export async function getSubscription(businessId: string) {
  const data = await one('select * from subscription where business_id = $1', [businessId]);
  const plan = (data?.plan as PlanType) ?? 'free';
  return {
    plan,
    status: data?.status ?? 'trialing',
    trialEndsAt: data?.trial_ends_at ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
    limits: { customerListLimit: plan === 'free' ? env.FREE_PLAN_CUSTOMER_LIMIT : null },
    paymentsEnabled: env.PAYMENTS_ENABLED,
  };
}

/**
 * Upgrade to premium. Real payment charging is DEFERRED (PAYMENTS_ENABLED=false):
 * this flips the plan directly, matching the app's store.upgrade behavior. When
 * payments are enabled, this returns a checkout intent instead.
 */
export async function upgrade(businessId: string) {
  if (env.PAYMENTS_ENABLED) {
    // TODO: create a Razorpay/Stripe order and return the checkout payload.
    return { plan: 'premium', requiresPayment: true, checkout: null };
  }
  const now = new Date().toISOString();
  await exec(
    `update subscription
        set plan = 'premium', status = 'active', current_period_start = $1, updated_at = $1
      where business_id = $2`,
    [now, businessId],
  );
  emitToOwners(businessId, 'subscription:updated', { plan: 'premium', status: 'active' });
  return getSubscription(businessId);
}

export async function cancel(businessId: string) {
  await exec(
    `update subscription set plan = 'free', status = 'canceled', updated_at = $1 where business_id = $2`,
    [new Date().toISOString(), businessId],
  );
  emitToOwners(businessId, 'subscription:updated', { plan: 'free', status: 'canceled' });
  return getSubscription(businessId);
}
