import { supabase } from '../../db/supabase';
import { env } from '../../config/env';
import { PlanType } from '../../domain/enums';
import { emitToOwners } from '../../realtime/emitters';

/** Live plan lookup (authoritative) — used by plan-gated reads so an upgrade
 * takes effect immediately without waiting for a token refresh. */
export async function getLivePlan(businessId: string): Promise<PlanType> {
  const { data } = await supabase.from('subscription').select('plan').eq('business_id', businessId).maybeSingle();
  return (data?.plan as PlanType) ?? 'free';
}

export async function getSubscription(businessId: string) {
  const { data } = await supabase.from('subscription').select('*').eq('business_id', businessId).maybeSingle();
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
  await supabase
    .from('subscription')
    .update({
      plan: 'premium',
      status: 'active',
      current_period_start: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('business_id', businessId);
  emitToOwners(businessId, 'subscription:updated', { plan: 'premium', status: 'active' });
  return getSubscription(businessId);
}

export async function cancel(businessId: string) {
  await supabase
    .from('subscription')
    .update({ plan: 'free', status: 'canceled', updated_at: new Date().toISOString() })
    .eq('business_id', businessId);
  emitToOwners(businessId, 'subscription:updated', { plan: 'free', status: 'canceled' });
  return getSubscription(businessId);
}
