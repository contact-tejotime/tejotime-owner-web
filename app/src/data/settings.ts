/** Static content for the Settings screens that stays UI-only (notifications, subscription).
 *  Profile, hours, services and staff now come from the API via the store. */

export type NotificationPref = {
  id: string;
  label: string;
  sub: string;
  enabled: boolean;
};

/** Fallbacks for bits the API doesn't provide yet. */
export const businessProfile = {
  bookingUrl: 'tejotime.com/sharp-cuts',
  username: 'sharpcuts',
};

export const notificationPrefs: NotificationPref[] = [
  { id: 'smsConfirm', label: 'Booking confirmations', sub: 'SMS when a customer books or joins', enabled: true },
  { id: 'queueAlerts', label: 'Queue updates', sub: 'Text customers as their turn nears', enabled: true },
  { id: 'noShowAlerts', label: 'No-show alerts', sub: 'Alert you when a customer misses their turn', enabled: false },
  { id: 'dailySummary', label: 'Daily summary', sub: 'Revenue & visits recap at closing time', enabled: true },
];

export const subscription = {
  plan: 'Free trial',
  badge: 'Trial',
  sub: '8 days left · upgrade anytime to keep full history',
  listSub: 'Free trial · 8 days left',
  cta: 'Upgrade to Premium',
  features: [
    'Unlimited customer history',
    'SMS & WhatsApp reminders',
    'Up to 5 staff seats',
    'Priority support',
  ],
};

export const appVersion = 'v2.4';

export const notificationsSub = `${notificationPrefs.filter((p) => p.enabled).length} of ${notificationPrefs.length} on`;
