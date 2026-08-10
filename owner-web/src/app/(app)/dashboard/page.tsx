import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HomeQueueSection } from "@/components/HomeQueueSection";
import { Icon } from "@/components/Icon";
import { ScopeNotice } from "@/components/ScopeNotice";
import { can, NO_ACCESS } from "@/lib/roles";
import { getMe, getQueue, getServices, getStaff } from "@/lib/server-api";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Home. Quick actions + the full live queue board.
 *
 * The queue read is uncached — customers join from the microsite, and nothing there
 * revalidates this app's cache.
 */
export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const showQueue = can(access, "queue");
  const staffScoped = me.user.role === "staff";

  const [queue, staff, services] = showQueue
    ? await Promise.all([getQueue(), getStaff(), getServices()])
    : [null, null, null];

  const seats = queue?.seats ?? [];
  const waitingLabel = queue
    ? staffScoped
      ? `${queue.summary.waitingCount} waiting · your chair`
      : `${queue.summary.waitingCount} waiting · ${queue.summary.seatCount} seats`
    : "—";

  // Staff walk-ins always land on their linked chair — don't offer every seat in the sheet.
  const walkInStaff = staffScoped
    ? (staff?.data ?? []).filter((s) => s.isActive && s.id === me.user.staffId)
    : (staff?.data ?? []).filter((s) => s.isActive);

  return (
    <div className={`page-app${staffScoped ? " page-app-staff" : ""}`}>
      <header className="home-header">
        <div className="home-header-left">
          <div className="home-avatar" aria-hidden>
            {initials(me.business.name)}
          </div>
          <div>
            <div className="home-title">{me.business.name}</div>
            <div className="home-sub">{waitingLabel}</div>
          </div>
        </div>
        <Link href="/settings/notifications" className="icon-btn" aria-label="Notifications">
          <Icon name="bell" size={20} />
        </Link>
      </header>

      <ScopeNotice me={me} context="your dashboard" />

      {showQueue ? (
        <Suspense fallback={null}>
          <HomeQueueSection
            seats={seats}
            staff={walkInStaff}
            services={(services?.data ?? []).filter((s) => s.isActive)}
            showQr={can(access, "profile")}
            singleChair={staffScoped || seats.length <= 1}
            category={me.business.category}
          />
        </Suspense>
      ) : can(access, "profile") ? (
        <>
          <h2 className="home-section-title">Quick actions</h2>
          <div className="home-actions home-actions-solo">
            <Link href="/settings" className="btn secondary home-action-secondary">
              <Icon name="qrCode" size={18} />
              Contact QR
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
