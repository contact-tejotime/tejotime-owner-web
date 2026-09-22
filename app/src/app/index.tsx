import { Redirect } from 'expo-router';

import { TSplashScreen } from '@/components/common';
import { useAppState } from '@/state/store';

export default function Index() {
  const { authed, authLoading, onboarded } = useAppState();

  // The launch screen, continued — see TSplashScreen for why every launch wait draws it.
  if (authLoading) return <TSplashScreen />;
  if (authed) return <Redirect href="/(app)/(tabs)/dashboard" />;
  // First launch only. A signed-in owner never sees the tour, even on a fresh install.
  if (!onboarded) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(auth)/login" />;
}
