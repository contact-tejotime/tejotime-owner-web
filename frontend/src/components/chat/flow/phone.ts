import { isValidPhoneNumber } from "libphonenumber-js";

/**
 * A phone number typed into the chat → E.164, or null.
 *
 * The pop-up has a country picker; a chat has one text box. So a number without a `+` is read as
 * local to the STORE (a customer of a Surat salon typing "98765 43210" means +91), and only then
 * as already carrying its own country code ("919876543210"). A leading trunk 0 ("098765…") is
 * dropped, as people routinely type it. Validation is libphonenumber's, the same library the
 * pop-up's PhoneField uses.
 */
export function parseTypedPhone(raw: string, storeDialCode: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  const dial = storeDialCode.replace(/\D/g, "");
  const candidates = s.startsWith("+") ? [`+${digits}`] : [`+${dial}${digits.replace(/^0+/, "")}`, `+${digits}`];
  for (const c of candidates) {
    try {
      if (isValidPhoneNumber(c)) return c;
    } catch {
      /* try the next reading */
    }
  }
  return null;
}

/** "+919876543210" → "+91 98••••••10": enough to recognise your own number, not to read someone else's. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 6) return e164;
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const cc = digits.slice(0, digits.length - national.length);
  const masked = `${national.slice(0, 2)}${"•".repeat(Math.max(0, national.length - 4))}${national.slice(-2)}`;
  return cc ? `+${cc} ${masked}` : masked;
}
