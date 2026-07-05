import { Redirect, Stack } from 'expo-router';

import { TLoader } from '@/components/common';
import { useAppState } from '@/state/store';

export default function AuthLayout() {
  const { authed, authLoading } = useAppState();

  if (authLoading) return <TLoader />;
  if (authed) return <Redirect href="/(app)/(tabs)/dashboard" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}
