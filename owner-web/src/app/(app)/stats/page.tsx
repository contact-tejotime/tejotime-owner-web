import Link from "next/link";
import { t, format, plural } from "@/i18n";
import { redirect } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { ScopeNotice } from "@/components/ScopeNotice";
import { formatMoney } from "@/lib/format";
import { can, NO_ACCESS } from "@/lib/roles";
import {
  getDashboard,
  getDashboardByStaff,
  getMe,
  getQueue,
  type DashboardStaffRow,
} from "@/lib/server-api";

type ReportRange = "today" | "month";

function parseRange(raw: string | undefined): ReportRange {
  return raw === "month" ? "month" : "today";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function sortStaff(rows: DashboardStaffRow[]): DashboardStaffRow[] {
  return [...rows].sort(
    (a, b) =>
      b.revenue.amount - a.revenue.amount ||
      b.completed - a.completed ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Reports. Today / month KPIs; staff see their chair only; store-wide roles also get
 * a per-staff breakdown. Queue preview stays on Today when the caller can see the queue.
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);

  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const showQueue = can(access, "queue");
  const scoped = me.user.role === "staff";
  const showByStaff = !scoped;

  const [dashboard, byStaff, queue] = await Promise.all([
    getDashboard(range),
    showByStaff ? getDashboardByStaff(range) : Promise.resolve(null),
    showQueue && range === "today" ? getQueue() : Promise.resolve(null),
  ]);
  const kpis = dashboard?.kpis;
  const periodLabel = dashboard?.periodLabel;
  const staffRows = sortStaff(byStaff?.data ?? []);

  const preview = (queue?.seats ?? [])
    .flatMap((seat) => seat.cards.map((card) => ({ ...card, staff: seat.name })))
    .sort(
      (a, b) =>
        Number(a.status === "waiting") - Number(b.status === "waiting") || a.position - b.position,
    )
    .slice(0, 3);

  const rangeTitle = range === "month" ? t.stats.thisMonth : t.stats.today;
  const headerTitle = scoped ? t.stats.myReport : t.stats.storeReport;
  const subtitle =
    periodLabel ?? (range === "month" ? t.stats.monthToDate : t.stats.todayAtAGlance);

  const appts = kpis?.todaysAppointments ?? null;
  const completed = kpis?.completed ?? null;
  const active = kpis ? kpis.activeNow + kpis.waitingNow : null;
  const revenue = kpis ? formatMoney(kpis.revenue) : "—";

  return (
    <div className="page-app">
      <AppPageHeader title={t.stats.title} subtitle={subtitle} showSettings={false} />

      <ScopeNotice me={me} context={t.stats.scopeContext} />

      <div className="segmented report-range" role="tablist" aria-label={t.stats.rangeAria}>
        <Link
          href="/stats?range=today"
          className={`segmented-btn${range === "today" ? " active" : ""}`}
          role="tab"
          aria-selected={range === "today"}
        >
          {t.stats.today}
        </Link>
        <Link
          href="/stats?range=month"
          className={`segmented-btn${range === "month" ? " active" : ""}`}
          role="tab"
          aria-selected={range === "month"}
        >
          {t.stats.thisMonth}
        </Link>
      </div>

      <section className="report-hero" aria-labelledby="report-hero-title">
        <div className="report-hero-top">
          <div>
            <p className="report-hero-eyebrow">{rangeTitle}</p>
            <h2 id="report-hero-title" className="report-hero-title">
              {headerTitle}
            </h2>
            {scoped && me.user.name ? (
              <p className="report-hero-sub">{format(t.stats.chairOf, { name: me.user.name })}</p>
            ) : null}
          </div>
          <div className="report-hero-revenue">
            <span className="report-hero-revenue-label">
              {scoped ? t.stats.yourRevenue : t.stats.revenue}
            </span>
            <span className="report-hero-revenue-value">{revenue}</span>
          </div>
        </div>

        <div className={`report-metric-grid${range === "today" ? " is-today" : ""}`}>
          <div className="report-metric">
            <span className="report-metric-label">{t.stats.appointments}</span>
            <span className="report-metric-value">{appts ?? "—"}</span>
          </div>
          <div className="report-metric">
            <span className="report-metric-label">{t.stats.completed}</span>
            <span className="report-metric-value">{completed ?? "—"}</span>
          </div>
          {range === "today" ? (
            <div className="report-metric">
              <span className="report-metric-label">{t.stats.inQueueNow}</span>
              <span className="report-metric-value">{active ?? "—"}</span>
            </div>
          ) : null}
        </div>
      </section>

      {showByStaff ? (
        <section className="report-staff-section" aria-labelledby="report-staff-title">
          <div className="home-section-row">
            <h2 id="report-staff-title" className="home-section-title">
              {t.stats.staffBreakdown}
            </h2>
            <span className="report-staff-count">
              {plural(staffRows.length, t.stats.seatCountOne, t.stats.seatCount)}
            </span>
          </div>
          <p className="report-staff-lead">
            {range === "month"
              ? t.stats.leadMonth
              : t.stats.leadToday}
          </p>

          {staffRows.length === 0 ? (
            <p className="home-empty">{t.stats.noStaff}</p>
          ) : (
            <div className="report-staff-cards">
              <div className="report-staff-head" aria-hidden>
                <span>{t.stats.colStaff}</span>
                <span>{t.stats.colAppts}</span>
                <span>{t.stats.colDone}</span>
                <span>{t.stats.colRevenue}</span>
              </div>
              {staffRows.map((row, i) => (
                <article
                  key={row.staffId}
                  className={`report-staff-card${i === 0 && row.revenue.amount > 0 ? " is-top" : ""}`}
                >
                  <div className="report-staff-identity">
                    <span className="report-staff-avatar" aria-hidden>
                      {initials(row.name)}
                    </span>
                    <div className="report-staff-name">{row.name}</div>
                  </div>
                  <div className="report-staff-stat" data-label={t.stats.colAppts}>
                    <span className="report-staff-stat-value">{row.appointments}</span>
                  </div>
                  <div className="report-staff-stat" data-label={t.stats.colDone}>
                    <span className="report-staff-stat-value">{row.completed}</span>
                  </div>
                  <div className="report-staff-stat report-staff-stat-rev" data-label={t.stats.colRevenue}>
                    <span className="report-staff-stat-value">{formatMoney(row.revenue)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {showQueue && range === "today" ? (
        <section className="report-queue-section">
          <div className="home-section-row">
            <h2 className="home-section-title">{scoped ? t.stats.yourQueue : t.stats.activeQueue}</h2>
            <Link href="/dashboard" className="home-link">
              {t.stats.viewAll}
            </Link>
          </div>
          {preview.length === 0 ? (
            <p className="home-empty">
              {scoped ? t.stats.emptyYourQueue : t.stats.emptyQueue}
            </p>
          ) : (
            <div className="home-queue-list">
              {preview.map((q) => (
                <Link key={q.id} href="/dashboard" className="home-queue-card">
                  <div className="title">{q.name}</div>
                  <div className="meta">
                    {[q.service, q.staff, q.status === "waiting" ? q.rightText : t.stats.inService]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
