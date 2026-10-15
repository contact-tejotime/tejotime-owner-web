/** Canonical enumerations — mirror the Postgres enums in db/migrations/0001_init.sql. */

export const PLAN_TYPES = ['free', 'premium'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/**
 * `owner` is the super owner (one per business, created by the admin panel at provisioning);
 * `co_owner` has the same powers but cannot touch the super owner; `manager` is legacy and is
 * no longer assigned to new logins. Mirrors the `user_role` enum after migration 0018.
 */
export const USER_ROLES = ['owner', 'co_owner', 'manager', 'staff'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The roles the portal itself can create. The super owner is not one of them. */
export const CREATABLE_ROLES = ['co_owner', 'staff'] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

/**
 * How a service is priced. Mirrors the `ck_service_price_shape` check added in migration 0024.
 *
 * `unset` began as the honest reading of the `price_paise = 0` rows that predate the two modes.
 * It is now also a deliberate choice: a store may list a service with no price, so the customer
 * is asked for as little as possible. The microsite shows no price for it and the owner types
 * the amount at checkout (`queue_checkout` refuses to derive one).
 */
export const SERVICE_PRICE_TYPES = ['fixed', 'range', 'unset'] as const;
export type ServicePriceType = (typeof SERVICE_PRICE_TYPES)[number];

/** The modes an editor may pick — all of them, since "no price" is a legitimate choice. */
export const WRITABLE_SERVICE_PRICE_TYPES = ['fixed', 'range', 'unset'] as const;
export type WritableServicePriceType = (typeof WRITABLE_SERVICE_PRICE_TYPES)[number];

export const QUEUE_STATUSES = [
  'waiting',
  'in_service',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_SOURCES = ['walk_in', 'online'] as const;
export type QueueSource = (typeof QUEUE_SOURCES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ['online', 'owner'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/**
 * How a customer paid for a visit ("Paid by" at checkout). Mirrors the `ck_visit_payment_method`
 * check added in migration 0042.
 */
export const PAYMENT_METHODS = ['card', 'cash', 'venmo', 'zelle', 'cash_app', 'upi', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * A US store — one priced in dollars (`business.currency`, set in the admin panel). "Paid by" and
 * card payments on the PayPal reader are US-only (client decision 2026-10-15): PayPal's reader is
 * a US product here, and every other store checks out exactly as it did before them.
 */
export function isUsStore(currency: string | null | undefined): boolean {
  return (currency ?? '').toUpperCase() === 'USD';
}

/**
 * The "Paid by" choices a store's checkout offers: Card and Cash for a US store, and NONE for every
 * other store — no question at all, the old checkout (client decision 2026-10-15). The other codes
 * stay in PAYMENT_METHODS and the 0042 check, so recorded visits stay valid and a wider list (Venmo,
 * Zelle, Cash App, UPI, Other were in the first version) is a change here, not a migration.
 *
 * Hand-kept in owner-web's and the app's `lib/checkout-amount.ts` (`npm run test:checkout` pins
 * all three). The API refuses any method not listed here.
 */
export function paymentMethodsFor(currency: string | null | undefined): readonly PaymentMethod[] {
  return isUsStore(currency) ? ['card', 'cash'] : [];
}

/** Active = counts toward a seat's load / queue position (lib/queue.ts isActive). */
export const isActiveStatus = (s: QueueStatus): boolean =>
  s === 'waiting' || s === 'in_service';

/** Display label for a queue/appointment status (StatusBadge.tsx STATUS_MAP). */
export const STATUS_LABELS: Record<string, string> = {
  waiting: 'Waiting',
  in_service: 'In service',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  pending: 'Upcoming',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
};
