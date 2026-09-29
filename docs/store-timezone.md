# Store timezone

`business.timezone` (IANA name) is the zone a store's **own clock** runs in: the microsite's
"Open now · till 6:00 PM" / "Closed · Opens …" label (`computeOpenStatus`,
`backend/src/modules/public/public.service.ts`), the daily token reset, and per-store analytics
day buckets. The visitor's browser zone is never used — the label is built on the server from the
store's zone, so a Florida store reads the same from Mumbai.

## Where it comes from

- **Admin Create/Edit store** has a *Timezone* dropdown. **Automatic** (the default, sent as `""`)
  lets the API pick it from the phone number; choosing a zone stores exactly that.
- `backend/src/lib/phone-timezone.ts::timezoneForPhone(countryCode, nationalNumber)`:
  dial code → zone (`91` → `Asia/Kolkata`, `44` → `Europe/London`, …); `+1` → NANP area-code table
  (`213` → Los Angeles, `312` → Chicago, `307` → Denver, unlisted → New York); unknown country →
  `null`, so the platform default (`DEFAULT_TIMEZONE`, `Asia/Kolkata`) applies.
- Hand-mirrored to `admin-panel/src/lib/phone-timezone.ts` (the form shows the guess on the
  *Automatic* option). No generator — keep the two identical.
- **A number only suggests a zone.** +1 spans six US zones and is shared with Canada, and a store
  can hold an out-of-region number: Empire Cutz is in Fort Myers, FL with a Wyoming `307`, so
  Automatic gives Mountain and the admin must pick Eastern. Always check US stores.

## Rules

- **Create**: explicit zone → else derived from the number → else `DEFAULT_TIMEZONE`.
- **Update**: an edit that omits the zone **keeps the stored one**. (It used to reset to the default
  on every save.)
- Both admin and owner APIs reject a zone `Intl` does not know (400) — `dayjs.tz` throws on one
  and would take the public page down.
- Migration `0033_business_timezone_from_phone.sql` backfills existing stores that are still on the
  IST default with a non-`91` dial code. Run it before promoting the image; then review US stores.

Owner-web settings and the mobile app only display/PATCH `timezone` already; no change there.

Tests: `backend/tests/unit/phone-timezone` cases live in `store-timezone.test.ts`; the label
arithmetic is in `open-status.test.ts`.
