import Link from "next/link";
import { redirect } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { ScopeNotice } from "@/components/ScopeNotice";
import { formatMoney } from "@/lib/format";
import { can, NO_ACCESS } from "@/lib/roles";
import { getDashboard, getMe, getQueue } from "@/lib/server-api";

/**
 * Stats. Active queue preview + today's KPI summary (moved off Home).
 */
export default async function StatsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const showQueue = can(access, "queue");

  const [dashboard, queue] = await Promise.all([
    getDashboard(),
    showQueue ? getQueue() : Promise.resolve(null),
  ]);
  const kpis = dashboard?.kpis;

  // A staff member's KPIs and queue are their own chair's, not the shop's. Reusing the
  // shop-wide labels would quietly misreport their day as the business's.
  const scoped = me.user.role === "staff" || me.user.role === "manager";

  const preview = (queue?.seats ?? [])
    .flatMap((seat) => seat.cards.map((card) => ({ ...card, staff: seat.name })))
    .sort(
      (a, b) =>
        Number(a.status === "waiting") - Number(b.status === "waiting") || a.position - b.position,
    )
    .slice(0, 3);

  return (
    <div className="page-app">
      <AppPageHeader title="Stats" subtitle="Today at a glance" showSettings={false} />

      <ScopeNotice me={me} context="your dashboard" />

      {showQueue ? (
        <>
          <div className="home-section-row">
            <h2 className="home-section-title">{scoped ? "Your queue" : "Active queue"}</h2>
            <Link href="/dashboard" className="home-link">
              View all
            </Link>
          </div>
          {preview.length === 0 ? (
            <p className="home-empty">
              {scoped ? "No one in your queue right now" : "No one in the queue right now"}
            </p>
          ) : (
            <div className="home-queue-list">
              {preview.map((q) => (
                <Link key={q.id} href="/dashboard" className="home-queue-card">
                  <div className="title">{q.name}</div>
                  <div className="meta">
                    {[q.service, q.staff, q.status === "waiting" ? q.rightText : "In service"]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : null}

      <h2 className="home-section-title">{scoped ? "Your day" : "Today's summary"}</h2>
      <div className="home-kpi-grid">
        <div className="stat-card">
          <div className="label">Today&apos;s appts</div>
          <div className="value">{kpis?.todaysAppointments ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active</div>
          <div className="value">{kpis ? kpis.activeNow + kpis.waitingNow : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="label">Check in</div>
          <div className="value">{kpis?.checkInCount ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="label">{scoped ? "Your revenue" : "Today's revenue"}</div>
          <div className="value">{kpis ? formatMoney(kpis.revenue) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
