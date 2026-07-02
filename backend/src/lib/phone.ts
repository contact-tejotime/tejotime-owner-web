/** Phone normalization to E.164, default region +91 (India). See docs/05 cross-cutting. */

export function normalizePhone(input: string, defaultCountry = '91'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (hasPlus) return `+${digits}`;
  // Bare 10-digit Indian number → prefix default country code.
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}
