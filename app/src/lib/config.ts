/**
 * Runtime config. Override with EXPO_PUBLIC_* env vars.
 *
 * Reachability note (base URL must resolve from where the app runs):
 *  - iOS simulator / web:  http://localhost:8080
 *  - Android emulator:     http://10.0.2.2:8080
 *  - physical device:      http://<your-LAN-IP>:8080
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export const SOCKET_URL =
  process.env.EXPO_PUBLIC_SOCKET_URL ?? 'http://localhost:8080';
