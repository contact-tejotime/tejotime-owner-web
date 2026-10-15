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

/**
 * PayPal card reader (docs/card-payments-paypal.md). The client ids come from PayPal's developer
 * portal (developer.zettle.com) — one app per platform — and are not secrets: they identify the
 * app, and every charge still needs the store owner's own PayPal sign-in. Empty → card charging is
 * simply not offered on this build.
 *
 * The redirect URL is also registered with the OS at build time by the module's config plugin
 * (`modules/paypal-reader/app.plugin.js`, option `redirectUrl`), so the two must stay the same. It
 * is its own scheme, not `tejotime://`, which expo-router owns.
 *
 * DEV MODE: PayPal's developer mode answers charges and refunds with no merchant account and no
 * real money, from any country. On for local and preprod builds; NEVER on a production build.
 */
export const PAYPAL_CLIENT_ID_IOS = process.env.EXPO_PUBLIC_PAYPAL_CLIENT_ID_IOS ?? '';
export const PAYPAL_CLIENT_ID_ANDROID = process.env.EXPO_PUBLIC_PAYPAL_CLIENT_ID_ANDROID ?? '';
export const PAYPAL_REDIRECT_URL = process.env.EXPO_PUBLIC_PAYPAL_REDIRECT_URL ?? 'tejotime-paypal://login.callback';
export const PAYPAL_DEV_MODE = process.env.EXPO_PUBLIC_PAYPAL_DEV_MODE === 'true';
