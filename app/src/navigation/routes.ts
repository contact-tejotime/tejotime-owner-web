export type TabId = 'dashboard' | 'queue' | 'appointments' | 'customers' | 'settings';

export const TAB_ROUTES: Record<TabId, string> = {
  dashboard: '/(app)/(tabs)/dashboard',
  queue: '/(app)/(tabs)/queue',
  appointments: '/(app)/(tabs)/appointments',
  customers: '/(app)/(tabs)/customers',
  settings: '/(app)/(tabs)/settings',
};

export type SettingsPageId = 'profile' | 'hours' | 'services' | 'staff' | 'notifications' | 'subscription';

export const SETTINGS_ROUTES: Record<SettingsPageId, string> = {
  profile: '/(app)/settings/profile',
  hours: '/(app)/settings/hours',
  services: '/(app)/settings/services',
  staff: '/(app)/settings/staff',
  notifications: '/(app)/settings/notifications',
  subscription: '/(app)/settings/subscription',
};

export function tabFromPathname(pathname: string): TabId {
  if (pathname.includes('/queue')) return 'queue';
  if (pathname.includes('/appointments')) return 'appointments';
  if (pathname.includes('/customers')) return 'customers';
  if (pathname.includes('/settings')) return 'settings';
  return 'dashboard';
}
