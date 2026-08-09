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

/**
 * Public customer web app — where a store's microsite and its QR landing page live.
 * Used to build the QR the owner shows customers; the backend derives the same URLs in
 * `getQr`, so keep this pointed at the same host as the API's `PUBLIC_WEB_URL`.
 */
export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';
