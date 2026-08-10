export type TabId = 'dashboard' | 'stats' | 'appointments' | 'calendar' | 'customers' | 'settings';

export const TAB_ROUTES: Record<TabId, string> = {
  dashboard: '/(app)/(tabs)/dashboard',
  stats: '/(app)/(tabs)/stats',
  appointments: '/(app)/(tabs)/appointments',
  calendar: '/(app)/(tabs)/calendar',
  customers: '/(app)/(tabs)/customers',
  settings: '/(app)/(tabs)/settings',
};

/** Legacy route — redirects to Home; kept for bookmarks / deep links. */
export const QUEUE_ROUTE = '/(app)/(tabs)/queue';

export type SettingsPageId =
  | 'profile'
  | 'appearance'
  | 'hours'
  | 'services'
  | 'staff'
  | 'team'
  | 'password'
  | 'notifications'
  | 'subscription';

export const SETTINGS_ROUTES: Record<SettingsPageId, string> = {
  profile: '/(app)/settings/profile',
  appearance: '/(app)/settings/appearance',
  hours: '/(app)/settings/hours',
  services: '/(app)/settings/services',
  staff: '/(app)/settings/staff',
  team: '/(app)/settings/team',
  password: '/(app)/settings/password',
  notifications: '/(app)/settings/notifications',
  subscription: '/(app)/settings/subscription',
};

export function tabFromPathname(pathname: string): TabId {
  // Old Queue tab redirects to Home — highlight Home while the replace runs.
  if (pathname.includes('/queue')) return 'dashboard';
  if (pathname.includes('/stats')) return 'stats';
  if (pathname.includes('/appointments')) return 'appointments';
  if (pathname.includes('/calendar')) return 'calendar';
  if (pathname.includes('/customers')) return 'customers';
  if (pathname.includes('/settings')) return 'settings';
  return 'dashboard';
}
