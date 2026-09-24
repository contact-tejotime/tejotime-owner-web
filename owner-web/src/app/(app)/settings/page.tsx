import { redirect } from "next/navigation";

import { t, format, plural } from "@/i18n";
import { can, NO_ACCESS } from "@/lib/roles";
import {
  getBusiness,
  getBusinessQr,
  getMe,
  getServices,
  getStaff,
  type BusinessDetail,
} from "@/lib/server-api";
import { SettingsScreen } from "./SettingsScreen";

/** Monday-first, the order the app's hours editor lists the week in (`app/src/lib/hours.ts`). */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 'HH:MM' or 'HH:MM:SS' → '9:00 AM', the app's label for a time. */
function to12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return time;
  return `${((h + 11) % 12) + 1}:${mStr ?? "00"} ${h < 12 ? t.hours.am : t.hours.pm}`;
}

/**
 * "6 days a week · 9:00 AM – 9:00 PM" — the app's `hoursSummary`, ported rule for rule: open days
 * are counted, and the times are the FIRST open day's in Monday-first order.
 */
function hoursSummary(hours: BusinessDetail["hours"]): string {
  const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));
  const open = DISPLAY_ORDER.map((d) => byDay.get(d)).filter(
    (h): h is BusinessDetail["hours"][number] => !!h && !h.isClosed && !!h.opensAt && !!h.closesAt,
  );
  if (!open.length) return t.settings.hoursEmpty;
  return format(t.settings.hoursSummary, {
    count: open.length,
    from: to12h(open[0].opensAt!),
    to: to12h(open[0].closesAt!),
  });
}

/**
 * Server shell: resolves the session and the facts the rows summarise, then hands them to the
 * interactive screen (the Dark mode switch and Sign out need the client).
 *
 * The row subtitles carry live data, as on the app — "Sharp Cuts · Bandra", "6 days a week ·
 * 10:00 AM – 8:00 PM", "5 services", "3 seats". Each read is gated on the permission its row is
 * gated on, because `GET /business` and `/business/qr` are profile-gated on the API. A read that
 * is refused or fails falls back to the row's static description rather than to a fabricated
 * "0 services" or "Set your hours" — the app would show those, but only because its store
 * starts empty; a web page that could not load a count has no business asserting one.
 */
export default async function SettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const canProfile = can(access, "profile");

  const [business, qr, services, staff] = await Promise.all([
    canProfile ? getBusiness() : Promise.resolve(null),
    canProfile ? getBusinessQr() : Promise.resolve(null),
    can(access, "services") ? getServices() : Promise.resolve(null),
    can(access, "staff") ? getStaff() : Promise.resolve(null),
  ]);

  const storeName = business?.name ?? me.business.name;
  // Active only: the app counts `/services?active=true` and `/staff?active=true`.
  const serviceCount = services ? services.data.filter((s) => s.isActive).length : null;
  const seatCount = staff ? staff.data.filter((s) => s.isActive).length : null;

  return (
    <SettingsScreen
      role={me.user.role}
      access={access}
      storeName={storeName}
      logoUrl={business?.logoUrl ?? null}
      userName={me.user.name?.trim() || null}
      storeMode={me.business.theme?.mode ?? "light"}
      cardUrl={qr?.cardUrl ?? null}
      subs={{
        profile: [business?.name, business?.area].filter(Boolean).join(" · ") || t.settings.businessProfileSub,
        hours: business ? hoursSummary(business.hours ?? []) : t.settings.workingHoursSub,
        services:
          serviceCount === null
            ? t.settings.servicesSub
            : plural(serviceCount, t.settings.servicesCountOne, t.settings.servicesCount),
        staff:
          seatCount === null
            ? t.settings.staffSub
            : plural(seatCount, t.settings.seatsCountOne, t.settings.seatsCount),
      }}
    />
  );
}
