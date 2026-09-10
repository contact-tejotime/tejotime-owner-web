import { Redirect, Stack } from 'expo-router';

import { TLoader } from '@/components/common';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  const { authed, authLoading } = useAppState();
  const { colors } = useTheme();

  if (authLoading) return <TLoader />;
  if (authed) return <Redirect href="/(app)/(tabs)/dashboard" />;

  return (
    // contentStyle is required on EVERY navigator — see the note in the root layout.
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}
