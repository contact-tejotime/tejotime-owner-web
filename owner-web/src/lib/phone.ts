import { parsePhoneNumber, isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';

import { COUNTRIES, type Country } from './countries';

export { COUNTRIES };
export type { Country };

/** Default country for new inputs (India). */
export const DEFAULT_ISO2 = 'IN';
export const DEFAULT_DIAL_CODE = '91';

/** Emoji flag from an ISO 3166-1 alpha-2 code, computed at runtime (no data). */
export function flagEmoji(iso2: string): string {
  const cc = (iso2 || '').toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '🏳️';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65));
}

/** Look up a country by ISO-2 code. */
export function countryByIso(iso2: string): Country | undefined {
  return COUNTRIES.find((c) => c.iso2 === iso2);
}

/**
 * Best country match for a dial code. Several countries share a calling code
 * (e.g. +1); this returns the first match, used only to seed the picker's flag.
 * The stored value is always the dial code itself, never the ISO.
 */
export function countryByDial(dialCode: string): Country | undefined {
  const d = onlyDigits(dialCode);
  return COUNTRIES.find((c) => c.dialCode === d);
}

function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/** Combine a dial code + national number into E.164 (`+<cc><national>`). */
export function combineToE164(dialCode: string, national: string): string {
  const n = onlyDigits(national);
  if (!n) return '';
  return `+${onlyDigits(dialCode)}${n}`;
}

/** Combine a dial code + national number into a bare digit string (`<cc><national>`). */
export function combineToDigits(dialCode: string, national: string): string {
  return `${onlyDigits(dialCode)}${onlyDigits(national)}`;
}

/**
 * Format a stored phone (E.164 `+919824410712` or bare digits `919824410712`)
 * for display as `+<dialcode> <national>`, e.g. `+91 9824410712`.
 * Falls back to the raw input when it can't be parsed (legacy/malformed rows).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  try {
    const input = trimmed.startsWith('+') ? trimmed : `+${onlyDigits(trimmed)}`;
    const parsed = parsePhoneNumber(input);
    if (parsed) return `+${parsed.countryCallingCode} ${parsed.nationalNumber}`;
  } catch {
    /* fall through to raw */
  }
  return trimmed;
}

/**
 * Split a stored phone into { dialCode, national, iso2 } to seed an editable
 * field. Falls back to the default country with the whole value as national.
 */
export function splitPhone(raw: string | null | undefined): {
  dialCode: string;
  national: string;
  iso2: string;
} {
  const trimmed = (raw ? String(raw) : '').trim();
  if (trimmed) {
    try {
      const input = trimmed.startsWith('+') ? trimmed : `+${onlyDigits(trimmed)}`;
      const parsed = parsePhoneNumber(input);
      if (parsed) {
        const dialCode = String(parsed.countryCallingCode);
        return {
          dialCode,
          national: String(parsed.nationalNumber),
          iso2: parsed.country ?? countryByDial(dialCode)?.iso2 ?? DEFAULT_ISO2,
        };
      }
    } catch {
      /* fall through to default */
    }
  }
  return { dialCode: DEFAULT_DIAL_CODE, national: onlyDigits(trimmed), iso2: DEFAULT_ISO2 };
}

/** Validate a national number against the selected country. */
export function isValidNational(national: string, iso2: string): boolean {
  const n = onlyDigits(national);
  if (!n) return false;
  try {
    return isValidPhoneNumber(n, iso2 as CountryCode);
  } catch {
    return n.length >= 4;
  }
}

/** Filter the country list by a free-text query (name, ISO code, or dial code). */
export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRIES;
  const qDigits = q.replace(/\D/g, '');
  return COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.iso2.toLowerCase().includes(q) ||
      (qDigits.length > 0 && c.dialCode.includes(qDigits)) ||
      `+${c.dialCode}`.includes(q),
  );
}
