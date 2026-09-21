/** Pure gate: never dispatch Twilio unless this visit opted in and has not opted out. */
export function shouldDispatchSms(input: {
  customerPhone: string | null | undefined;
  smsOptIn: boolean | null | undefined;
  smsOptOutAt?: string | null;
}): boolean {
  if (!input.customerPhone) return false;
  if (input.smsOptIn !== true) return false;
  if (input.smsOptOutAt) return false;
  return true;
}
