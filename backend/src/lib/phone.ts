/** Phone normalization to E.164, default region +1 (United States). See docs/05 cross-cutting. */

export function normalizePhone(input: string, defaultCountry = '1'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (hasPlus) return `+${digits}`;
  // Bare 10-digit national number → prefix the default country code.
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}
