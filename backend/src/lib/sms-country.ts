/**
 * Which countries may receive a text (TWILIO_ALLOWED_COUNTRY_CODES, docs/sms-opt-in-a2p.md).
 *
 * The A2P 10DLC campaign approved on 2026-10-06 covers US numbers only. Twilio would happily send
 * a +91 customer's text from the US number as international SMS — outside the campaign, billed at
 * international rates, and filtered by Indian carriers — so every send is refused unless the
 * recipient's calling code is listed on purpose. Adding a country is an env change, not a deploy.
 *
 * Kept import-free: config/env.ts validates the variable with parseCountryCodes at boot.
 */

/** What an unset or blank variable means: US only, the one country the campaign covers. */
export const DEFAULT_SMS_COUNTRY_CODES = ['1'] as const;

/**
 * "1" / "+1, 91" → ['1', '91']. Unset or blank → the US-only default. Anything that is not a
 * comma-separated list of 1-3 digit calling codes ("US", "1;91", "1234") → null, so env.ts can
 * refuse to boot rather than silently text nobody (or everybody).
 */
export function parseCountryCodes(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_SMS_COUNTRY_CODES];
  const codes: string[] = [];
  for (const part of raw.split(',')) {
    const code = part.trim().replace(/^\+/, '');
    if (!/^\d{1,3}$/.test(code)) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * True when `phone` is E.164 ("+" then digits only) and starts with a listed calling code.
 *
 * A plain prefix test is exact because E.164 calling codes are prefix-free: no country's code is
 * the start of another's, so "1" can only ever match the +1 plan. Note that +1 is the whole North
 * American plan — US, Canada and most of the Caribbean share it, and a calling code cannot tell
 * them apart.
 *
 * A number without the "+" is refused: its country cannot be known, and normalizePhone
 * (lib/phone.ts) gives every number it accepts a "+", so only legacy rows lack one.
 */
export function isSmsCountryAllowed(phone: string, codes: readonly string[]): boolean {
  const m = /^\+(\d+)$/.exec(phone.trim());
  if (!m) return false;
  const digits = m[1];
  return codes.some((code) => digits.startsWith(code));
}
