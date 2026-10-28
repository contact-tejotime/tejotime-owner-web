import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import {
  PAYPAL_CLIENT_ID_ANDROID,
  PAYPAL_CLIENT_ID_IOS,
  PAYPAL_DEV_MODE,
  PAYPAL_REDIRECT_URL,
} from '@/lib/config';

/**
 * The PayPal POS Card Reader, through PayPal's native Zettle Payments SDK
 * (`modules/paypal-reader`, docs/card-payments-paypal.md).
 *
 * PayPal offers no web or server way to start a charge on its reader — only the native SDK on the
 * phone, over Bluetooth — which is why card charging exists on the app and not on owner-web.
 *
 * The native module is OPTIONAL: it is absent in Expo Go, on the app's web target, and in any
 * build made before it was added. `isCardReaderAvailable()` is the one question every screen asks
 * first; when it says no, the app behaves exactly as it did before card payments (Card is a plain
 * "Paid by" choice that records a card charged elsewhere).
 *
 * Amounts cross this boundary in MINOR units (cents), like every amount in the API. The native side
 * converts for iOS, whose SDK takes a decimal amount.
 */

/** What the reader reported for a charge (or for a reference looked up after a lost response). */
export interface ReaderChargeResult {
  /**
   * completed — the card was charged. canceled — the owner backed out before the card was read.
   * failed — declined or an error (`reason`). not_found — `retrieve` knows no charge with that
   * reference, so it is safe to charge it.
   */
  status: 'completed' | 'canceled' | 'failed' | 'not_found';
  reason?: string | null;
  /** What was actually charged, minor units. Tipping is always off, so it should be the bill. */
  amountMinor?: number | null;
  cardBrand?: string | null;
  /** The last four digits only — the native side never passes the masked number up. */
  cardLast4?: string | null;
  entryMode?: string | null;
  /** PayPal's own id for the transaction. */
  transactionId?: string | null;
}

export interface ReaderRefundResult {
  status: 'completed' | 'canceled' | 'failed';
  reason?: string | null;
  /** PayPal says it was refunded already — a retry after a lost response. Treated as success. */
  alreadyRefunded?: boolean;
  transactionId?: string | null;
}

/** The PayPal account the phone is signed in to, when the SDK says. */
export interface ReaderAccount {
  /** PayPal's organization id — saved on the store, so another account's phone is refused. */
  orgRef: string | null;
  currency: string | null;
  country: string | null;
  name: string | null;
}

interface NativePaypalReader {
  configure(opts: { clientId: string; redirectUrl: string; devMode: boolean }): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  login(): Promise<boolean>;
  logout(): Promise<void>;
  account(): Promise<ReaderAccount | null>;
  openReaderSettings(): Promise<void>;
  charge(opts: { amountMinor: number; reference: string }): Promise<ReaderChargeResult>;
  retrieve(reference: string): Promise<ReaderChargeResult>;
  refund(opts: { reference: string; amountMinor: number; refundReference: string }): Promise<ReaderRefundResult>;
}

const native =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireOptionalNativeModule<NativePaypalReader>('PaypalReader')
    : null;

const clientId = Platform.OS === 'ios' ? PAYPAL_CLIENT_ID_IOS : PAYPAL_CLIENT_ID_ANDROID;

/** Is card charging possible on this build at all? (Signed in or not is a separate question.) */
export function isCardReaderAvailable(): boolean {
  return !!native && clientId.length > 0;
}

/** Whether this build talks to PayPal's developer mode (no real money) — shown on the screen. */
export const cardReaderDevMode = PAYPAL_DEV_MODE;

let configured: Promise<void> | null = null;

/** The SDK is set up once per launch, the first time anything asks for it. */
function reader(): Promise<NativePaypalReader> {
  if (!native || !clientId) return Promise.reject(new Error('Card reader is not available on this build'));
  if (!configured) {
    configured = native
      .configure({ clientId, redirectUrl: PAYPAL_REDIRECT_URL, devMode: PAYPAL_DEV_MODE })
      .catch((e) => {
        configured = null;
        throw e;
      });
  }
  return configured.then(() => native);
}

export const cardReader = {
  isLoggedIn: async () => (await reader()).isLoggedIn(),
  login: async () => (await reader()).login(),
  logout: async () => (await reader()).logout(),
  account: async () => (await reader()).account(),
  openReaderSettings: async () => (await reader()).openReaderSettings(),
  /** Charge the card. `reference` is the card payment's id from `POST /card-payments`. */
  charge: async (amountMinor: number, reference: string) => (await reader()).charge({ amountMinor, reference }),
  /** What the reader knows about a reference — used before re-charging one, and to recover. */
  retrieve: async (reference: string) => (await reader()).retrieve(reference),
  /** Refund the whole charge back to the card (client decision 2026-10-15: never part of it). */
  refund: async (reference: string, amountMinor: number, refundReference: string) =>
    (await reader()).refund({ reference, amountMinor, refundReference }),
};
