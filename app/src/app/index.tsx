import { Redirect } from 'expo-router';

import { TLoader } from '@/components/common';
import { useAppState } from '@/state/store';

export default function Index() {
  const { authed, authLoading } = useAppState();

  if (authLoading) return <TLoader />;
  if (authed) return <Redirect href="/(app)/(tabs)/dashboard" />;
  return <Redirect href="/(auth)/login" />;
}
