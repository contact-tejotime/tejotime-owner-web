/** Static content for the Settings screens that stays UI-only (notifications, subscription).
 *  Profile, hours, services and staff now come from the API via the store. */
import { t, format } from '@/i18n';

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
  { id: 'smsConfirm', label: t.notifications.prefs.smsConfirmLabel, sub: t.notifications.prefs.smsConfirmSub, enabled: true },
  { id: 'queueAlerts', label: t.notifications.prefs.queueAlertsLabel, sub: t.notifications.prefs.queueAlertsSub, enabled: true },
  { id: 'noShowAlerts', label: t.notifications.prefs.noShowAlertsLabel, sub: t.notifications.prefs.noShowAlertsSub, enabled: false },
  { id: 'dailySummary', label: t.notifications.prefs.dailySummaryLabel, sub: t.notifications.prefs.dailySummarySub, enabled: true },
];

export const subscription = {
  plan: t.subscription.plan,
  badge: t.subscription.badge,
  sub: t.subscription.sub,
  listSub: t.subscription.listSub,
  cta: t.subscription.cta,
  features: t.subscription.features,
};

export const appVersion = t.subscription.appVersion;

export const notificationsSub = format(t.notifications.summary, {
  enabled: notificationPrefs.filter((p) => p.enabled).length,
  total: notificationPrefs.length,
});
