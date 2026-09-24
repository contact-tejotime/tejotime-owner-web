import Link from "next/link";
import { t } from "@/i18n";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HomeQueueSection } from "@/components/HomeQueueSection";
import { StoreMark } from "@/components/StoreMark";
import { Icon } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import { can, NO_ACCESS } from "@/lib/roles";
import { getBusiness, getBusinessQr, getMe, getQueue, getServices, getStaff } from "@/lib/server-api";

/** The store's own clock, not the server's (UTC on Railway), for the greeting and the date. */
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** "Good morning" before noon, "Good afternoon" until five, "Good evening" after. */
function greetingLine(timeZone: string): string {
  const now = new Date();
  // An unknown zone name throws; a bad value in the store's settings must not take Home down.
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    zone = DEFAULT_TIMEZONE;
  }
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now));
  const greeting =
    hour < 12 ? t.dashboard.greetingMorning : hour < 17 ? t.dashboard.greetingAfternoon : t.dashboard.greetingEvening;
  // Assembled from parts: en-GB renders September as "Sept", the app shows "Thu, 24 Sep".
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: zone })
      .formatToParts(now)
      .find((p) => p.type === type)?.value ?? "";
  const date = `${part("weekday")}, ${part("day")} ${part("month")}`;
  return `${greeting} · ${date}`;
}

/**
 * Home — the same blocks as the app's Home (docs/mobile-home-screen.md): a greeting header, the
 * brand-coloured live-queue card (Waiting · In service · Walk-in wait, with Add walk-in and the
 * booking QR), then the seat boards.
 *
 * The queue read is uncached — customers join from the microsite, and nothing there
 * revalidates this app's cache. `LiveRefresh` re-renders the page when the socket says the
 * queue changed, so those joins appear without a reload.
 */
export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const showQueue = can(access, "queue");
  const showQr = can(access, "profile");
  const staffScoped = me.user.role === "staff";

  // GET /business is profile-gated, like the QR. Without it the header shows initials and the
  // greeting falls back to the default timezone — the same as the app, whose logo comes from the
  // same read.
  const [queue, staff, services, qr, business] = await Promise.all([
    showQueue ? getQueue() : Promise.resolve(null),
    showQueue ? getStaff() : Promise.resolve(null),
    showQueue ? getServices() : Promise.resolve(null),
    showQr ? getBusinessQr() : Promise.resolve(null),
    showQr ? getBusiness() : Promise.resolve(null),
  ]);

  const seats = queue?.seats ?? [];

  // Staff walk-ins always land on their linked chair — don't offer every seat in the sheet.
  const walkInStaff = staffScoped
    ? (staff?.data ?? []).filter((s) => s.isActive && s.id === me.user.staffId)
    : (staff?.data ?? []).filter((s) => s.isActive);

  const cardUrl = qr?.cardUrl ?? null;
  const storeName = me.business.name;

  return (
    <div className={`page-app${staffScoped ? " page-app-staff" : ""}`}>
      {/* The old "1 waiting · 2 seats" subtitle repeated the live card, so the slot carries the
          day instead. */}
      <header className="home-header">
        <div className="home-header-left">
          <StoreMark name={storeName} logoUrl={business?.logoUrl ?? null} />
          <div className="home-header-text">
            <div className="home-sub">{greetingLine(business?.timezone || DEFAULT_TIMEZONE)}</div>
            <h1 className="home-title">{storeName}</h1>
          </div>
        </div>
        <Link href="/settings/notifications" className="icon-btn" aria-label={t.dashboard.notifications}>
          <Icon name="bell" size={20} />
        </Link>
      </header>

      <ScopeNotice me={me} context="your dashboard" />

      {showQueue ? (
        <LiveRefresh events={["queue:snapshot", "appointment:checked_in"]} pollOnly={staffScoped} />
      ) : null}

      {showQueue ? (
        <Suspense fallback={null}>
          <HomeQueueSection
            seats={seats}
            staff={walkInStaff}
            services={(services?.data ?? []).filter((s) => s.isActive)}
            showQr={showQr}
            cardUrl={cardUrl}
            storeName={storeName}
            singleChair={staffScoped || seats.length <= 1}
            category={me.business.category}
          />
        </Suspense>
      ) : showQr && cardUrl ? (
        // No queue access, so no live card to carry the QR shortcut. Keep it reachable on its own.
        <div className="home-actions home-actions-solo">
          <StoreBookingQr variant="button" label={t.dashboard.contactQr} cardUrl={cardUrl} storeName={storeName} />
        </div>
      ) : null}
    </div>
  );
}
