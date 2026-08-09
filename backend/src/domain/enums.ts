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
