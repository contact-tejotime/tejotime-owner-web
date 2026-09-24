/** Static content for the Settings screens that stays UI-only (notifications).
 *  Profile, hours, services and staff now come from the API via the store. */
import Constants from 'expo-constants';

import { t } from '@/i18n';

export type NotificationPref = {
  id: string;
  label: string;
  sub: string;
  enabled: boolean;
};

/** Fallbacks for bits the API doesn't provide yet. */
export const businessProfile = {
  bookingUrl: 'tejotime.com/sharp-cuts',
};

export const notificationPrefs: NotificationPref[] = [
  { id: 'smsConfirm', label: t.notifications.prefs.smsConfirmLabel, sub: t.notifications.prefs.smsConfirmSub, enabled: true },
  { id: 'queueAlerts', label: t.notifications.prefs.queueAlertsLabel, sub: t.notifications.prefs.queueAlertsSub, enabled: true },
  { id: 'noShowAlerts', label: t.notifications.prefs.noShowAlertsLabel, sub: t.notifications.prefs.noShowAlertsSub, enabled: false },
  { id: 'dailySummary', label: t.notifications.prefs.dailySummaryLabel, sub: t.notifications.prefs.dailySummarySub, enabled: true },
];

/**
 * The real shipped version, from app.json via expo-constants — NOT a hand-written string. This
 * was a literal `"v2.4"` in en.json while the app shipped as 1.0.3, so every owner read a version
 * that never existed and a bug report citing it would have pointed nowhere. A version is a build
 * fact, so it does not belong in the copy file at all.
 */
export const appVersion = `v${Constants.expoConfig?.version ?? '—'}`;

/**
 * Deliberately NOT "{n} of {m} on". `notificationPrefs` above is a hard-coded mock and the
 * Notifications screen keeps its toggles in local `useState` with no API behind them, so a count
 * here asserted a saved state that does not exist and reset itself on every launch. Until there is
 * an endpoint, the row describes what it opens instead of claiming a state.
 */
export const notificationsSub = t.settings.notificationsSub;
