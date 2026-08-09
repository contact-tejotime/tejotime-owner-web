import { Redirect } from 'expo-router';

/** Old Queue tab — the live board now lives on Home. */
export default function QueueRedirect() {
  return <Redirect href="/(app)/(tabs)/dashboard" />;
}
