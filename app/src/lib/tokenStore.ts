import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Token persistence — SecureStore on native, localStorage on web. */
const ACCESS = 'tt_access';
const REFRESH = 'tt_refresh';

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getTokens(): Promise<{ access: string | null; refresh: string | null }> {
  const [access, refresh] = await Promise.all([getItem(ACCESS), getItem(REFRESH)]);
  return { access, refresh };
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([setItem(ACCESS, access), setItem(REFRESH, refresh)]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([removeItem(ACCESS), removeItem(REFRESH)]);
}
