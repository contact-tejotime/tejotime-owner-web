/**
 * Store timezone from a phone number. A store's open/closed state, "closes at" label, daily token
 * reset and analytics day all run in `business.timezone`, and the admin form never asked for one —
 * so every store silently became `Asia/Kolkata`, including a Florida barbershop.
 *
 * Pure (no env, no DB) so it is pinned by a unit test. HAND-MIRRORED into
 * `admin-panel/src/lib/phone-timezone.ts` (the form previews the same answer); keep them identical.
 *
 * A number only *suggests* a zone. +1 spans six US zones and is shared with Canada, and a store can
 * hold an out-of-region number (Empire Cutz is in Fort Myers with a Wyoming 307), so the admin form
 * lets the admin override the guess and this module never gets the last word on a saved store.
 */

/** Dial code → the zone its capital / bulk of population uses. Multi-zone countries pick the main one. */
const BY_DIAL_CODE: Record<string, string> = {
  '91': 'Asia/Kolkata',
  '44': 'Europe/London',
  '353': 'Europe/Dublin',
  '61': 'Australia/Sydney',
  '64': 'Pacific/Auckland',
  '65': 'Asia/Singapore',
  '60': 'Asia/Kuala_Lumpur',
  '81': 'Asia/Tokyo',
  '86': 'Asia/Shanghai',
  '852': 'Asia/Hong_Kong',
  '92': 'Asia/Karachi',
  '880': 'Asia/Dhaka',
  '94': 'Asia/Colombo',
  '977': 'Asia/Kathmandu',
  '971': 'Asia/Dubai',
  '968': 'Asia/Muscat',
  '966': 'Asia/Riyadh',
  '965': 'Asia/Kuwait',
  '974': 'Asia/Qatar',
  '973': 'Asia/Bahrain',
  '27': 'Africa/Johannesburg',
  '234': 'Africa/Lagos',
  '254': 'Africa/Nairobi',
  '49': 'Europe/Berlin',
  '33': 'Europe/Paris',
  '39': 'Europe/Rome',
  '34': 'Europe/Madrid',
};

/** Zone → NANP (+1) area codes. Codes not listed fall back to Eastern; the admin can override. */
const NANP_AREA_CODES: Record<string, string> = {
  'America/Chicago':
    '205 251 256 334 659 938 479 501 870 217 224 309 312 331 618 630 708 773 779 815 847 872 ' +
    '319 515 563 641 712 316 620 785 913 225 337 504 985 318 218 320 507 612 651 763 952 ' +
    '228 601 662 769 314 417 573 636 660 816 557 402 531 701 405 539 580 918 572 605 ' +
    '615 629 731 901 931 210 214 254 281 325 361 409 430 469 512 682 713 726 737 806 817 830 ' +
    '832 903 936 940 956 972 979 262 414 534 608 715 920 274 850 219 204 431',
  'America/Denver': '303 719 720 970 983 208 986 406 505 575 385 435 801 307 915 403 587 780 825 368',
  'America/Phoenix': '480 520 602 623 928',
  'America/Los_Angeles':
    '209 213 279 310 323 341 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 ' +
    '747 760 805 818 820 831 840 858 909 916 925 949 951 702 725 775 458 503 541 971 206 253 360 ' +
    '425 509 564 236 250 604 672 778',
  'America/Anchorage': '907',
  'Pacific/Honolulu': '808',
  'America/Puerto_Rico': '787 939',
  'America/Halifax': '902 782 506',
  'America/Regina': '306 639',
};

const AREA_CODE_ZONE: Record<string, string> = {};
for (const [zone, codes] of Object.entries(NANP_AREA_CODES)) {
  for (const code of codes.split(' ')) AREA_CODE_ZONE[code] = zone;
}

const NANP_FALLBACK = 'America/New_York';

/**
 * The zone a phone number suggests, or `null` when the country is unknown (callers then keep the
 * platform default rather than guess). `countryCode` and `nationalNumber` are digits, as stored on
 * `business.country_code` / `business.phone_number`; anything else in either is ignored.
 */
export function timezoneForPhone(countryCode: string, nationalNumber: string): string | null {
  const cc = (countryCode ?? '').replace(/\D/g, '');
  if (cc === '1') {
    const national = (nationalNumber ?? '').replace(/\D/g, '');
    return AREA_CODE_ZONE[national.slice(0, 3)] ?? NANP_FALLBACK;
  }
  return BY_DIAL_CODE[cc] ?? null;
}

/** True for a real IANA zone name — `dayjs.tz` throws a RangeError on anything else. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
