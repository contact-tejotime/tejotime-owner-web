import Link from "next/link";
import type { CSSProperties } from "react";
import { t, format, plural } from "@/i18n";
import { redirect } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon, type IconName } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
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
import { gridColumnVars } from "./columns";
import { ReportQueuePreview } from "./ReportQueuePreview";
import "@/styles/reports.css";

type ReportRange = "today" | "month";

const RANGES: ReportRange[] = ["today", "month"];

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

/** The app's compact empty state (`TEmptyState compact`): icon in a soft brand disc, one line. */
function ReportEmpty({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="rp-empty">
      <span className="rp-empty-disc" aria-hidden>
        <Icon name={icon} size={20} />
      </span>
      <p className="rp-empty-title">{title}</p>
    </div>
  );
}

/**
 * Reports — the same screen as the app's Reports tab (app/src/app/(app)/(tabs)/stats.tsx), in the
 * same order: Today / This month, the revenue card on the store's brand colour, the metric tiles,
 * the staff breakdown (store-wide roles only), then the queue preview on Today.
 *
 * Staff see their own chair only — the API narrows every figure — so their card says "My report"
 * and "Your revenue", and they get no staff breakdown (the API would 403 it anyway).
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
  const staffRows = sortStaff(byStaff?.data ?? []);
  const seats = queue?.seats ?? [];

  // Seat order, then each seat's own order (serving first, then the line) — the app's
  // `flatCards(seats).slice(0, 3)`, so both surfaces preview the same three people.
  const preview = seats.flatMap((seat) => seat.cards).slice(0, 3);

  const subtitle =
    dashboard?.periodLabel ?? (range === "month" ? t.stats.monthToDate : t.stats.todayAtAGlance);
  const rangeEyebrow = range === "month" ? t.stats.thisMonth : t.stats.today;
  const headerTitle = scoped ? t.stats.myReport : t.stats.storeReport;
  const revenueLabel = scoped ? t.stats.yourRevenue : t.stats.revenue;
  const revenue = kpis ? formatMoney(kpis.revenue) : t.common.dash;
  // Average ticket: the one number a day's revenue can't tell on its own. Derived from two figures
  // the API already returns, so it can never disagree with them (same rule as the app).
  const revenueNote = !kpis
    ? null
    : kpis.completed > 0
      ? format(t.stats.avgPerVisit, {
          avg: formatMoney({ ...kpis.revenue, amount: Math.round(kpis.revenue.amount / kpis.completed) }),
        })
      : t.stats.noVisitsYet;
  const totalStaffRevenue = staffRows.reduce((n, r) => n + r.revenue.amount, 0);

  const metrics: { key: string; icon: IconName; label: string; value: string }[] = [
    {
      key: "appts",
      icon: "calendar",
      label: t.stats.appointments,
      value: kpis ? String(kpis.todaysAppointments) : t.common.dash,
    },
    {
      key: "completed",
      icon: "checkCircle",
      label: t.stats.completed,
      value: kpis ? String(kpis.completed) : t.common.dash,
    },
    ...(range === "today"
      ? [
          {
            key: "queue",
            icon: "users" as IconName,
            label: t.stats.inQueue,
            value: kpis ? String(kpis.activeNow + kpis.waitingNow) : t.common.dash,
          },
        ]
      : []),
  ];

  return (
    <div className="page-app rp">
      <AppPageHeader title={t.stats.title} subtitle={subtitle} showSettings={false} />

      <ScopeNotice me={me} context={t.stats.scopeContext} />

      {/* The app re-reads its figures when a booking lands or is checked in, and its queue preview
          follows the socket; this keeps the web page equally current. Staff sockets receive no
          emits yet, so staff poll (as on Home). */}
      <LiveRefresh
        events={["queue:snapshot", "appointment:created", "appointment:updated", "appointment:checked_in"]}
        pollOnly={scoped}
      />

      <div className="rp-range" role="tablist" aria-label={t.stats.rangeAria}>
        {RANGES.map((key) => (
          <Link
            key={key}
            href={`/stats?range=${key}`}
            scroll={false}
            className={`rp-range-btn${range === key ? " is-active" : ""}`}
            role="tab"
            aria-selected={range === key}
          >
            {key === "today" ? t.stats.today : t.stats.thisMonth}
          </Link>
        ))}
      </div>

      {/* On a phone: the app's brand revenue card over a row of tiles. On desktop the same markup
          becomes one row of equal `kpi-card`s — revenue plus the tiles — styled exactly like
          Home's live-queue cards (globals.css), at the owner's request: a wide brand banner beside
          three small tiles read as unrelated blocks. `--rp-cols` is 4 on Today, 3 on This month;
          `--rp-cols-md` is the narrow-desktop count (four cards don't fit beside the sidebar). */}
      <div
        className="rp-summary"
        style={
          { "--rp-cols": metrics.length + 1, "--rp-cols-md": metrics.length + 1 === 4 ? 2 : 3 } as CSSProperties
        }
      >
        <p className="rp-summary-eyebrow" aria-hidden>
          <span className="live-card-dot" />
          {`${rangeEyebrow} · ${headerTitle}`}
        </p>

        {/* Revenue leads, on the store's brand colour like Home's live card: it is the figure an
            owner opens Reports for. */}
        <section className="rp-hero kpi-card" aria-labelledby="rp-hero-title">
          <span className="rp-hero-icon kpi-card-icon" aria-hidden>
            <Icon name="creditCard" size={20} />
          </span>
          <div className="rp-hero-text kpi-card-text">
            <h2 id="rp-hero-title" className="rp-hero-eyebrow">
              {`${rangeEyebrow} · ${headerTitle}`}
            </h2>
            {scoped && me.user.name ? (
              <p className="rp-hero-sub">{format(t.stats.chairOf, { name: me.user.name })}</p>
            ) : null}
            <p className="rp-hero-label kpi-card-label">{revenueLabel}</p>
            {/* The web's version of the app's shrink-to-fit: reports.css sizes the figure by its
                length (`--rp-chars`) against the card, so it only shrinks when it would not fit.
                `is-long` is the step down for a browser without container units. */}
            <p
              className={`rp-hero-revenue kpi-card-value${revenue.length > 10 ? " is-long" : ""}`}
              style={{ "--rp-chars": revenue.length } as CSSProperties}
            >
              {revenue}
            </p>
            {revenueNote ? <p className="rp-hero-note kpi-card-note">{revenueNote}</p> : null}
          </div>
        </section>

        <div className="rp-metrics">
          {metrics.map((m) => (
            <div key={m.key} className="rp-metric kpi-card" role="group" aria-label={`${m.label}: ${m.value}`}>
              <span className="rp-metric-icon kpi-card-icon" aria-hidden>
                <Icon name={m.icon} size={16} />
              </span>
              <span className="rp-metric-figures kpi-card-text" aria-hidden>
                <span className="rp-metric-value kpi-card-value">{m.value}</span>
                <span className="rp-metric-label kpi-card-label">{m.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {showByStaff ? (
        <section className="rp-section" aria-labelledby="rp-staff-title">
          <div className="rp-section-head">
            <h2 id="rp-staff-title" className="home-section-title">
              {t.stats.staffBreakdown}
            </h2>
            <span className="rp-section-meta">
              {plural(staffRows.length, t.stats.seatCountOne, t.stats.seatCount)}
            </span>
          </div>
          <p className="rp-lead">{range === "month" ? t.stats.leadMonth : t.stats.leadToday}</p>

          {staffRows.length === 0 ? (
            <ReportEmpty icon="users" title={t.stats.noStaff} />
          ) : (
            <div className="rp-staff-grid" style={gridColumnVars(staffRows.length)}>
              {staffRows.map((row, i) => {
                const top = i === 0 && row.revenue.amount > 0;
                // Share of the shop's takings: who carried the day, readable without comparing
                // figures card to card. Hidden on a day with no revenue, where every bar is empty.
                const share =
                  totalStaffRevenue > 0 ? Math.round((row.revenue.amount / totalStaffRevenue) * 100) : null;
                const rowRevenue = formatMoney(row.revenue);
                return (
                  <article key={row.staffId} className={`rp-staff${top ? " is-top" : ""}`}>
                    <div className="rp-staff-id">
                      <span className="rp-staff-avatar" aria-hidden>
                        {initials(row.name)}
                      </span>
                      <h3 className="rp-staff-name">{row.name}</h3>
                    </div>

                    {share !== null ? (
                      <div className="rp-share">
                        <span className="rp-share-track" aria-hidden>
                          <span className="rp-share-fill" style={{ width: `${share}%` }} />
                        </span>
                        <span className="rp-share-label">{format(t.stats.shareOfRevenue, { pct: share })}</span>
                      </div>
                    ) : null}

                    <dl className="rp-staff-stats">
                      <div className="rp-staff-stat">
                        <dt>{t.stats.colAppts}</dt>
                        <dd>{row.appointments}</dd>
                      </div>
                      <div className="rp-staff-stat">
                        <dt>{t.stats.colDone}</dt>
                        <dd>{row.completed}</dd>
                      </div>
                      <div className="rp-staff-stat is-revenue">
                        <dt>{t.stats.colRevenue}</dt>
                        <dd className={rowRevenue.length > 10 ? "is-long" : undefined} title={rowRevenue}>
                          {rowRevenue}
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {showQueue && range === "today" ? (
        <section className="rp-section" aria-labelledby="rp-queue-title">
          <div className="rp-section-head">
            <h2 id="rp-queue-title" className="home-section-title">
              {scoped ? t.stats.yourQueue : t.stats.activeQueue}
            </h2>
            <Link href="/dashboard" className="rp-link">
              {t.stats.viewAll}
              {/* Desktop only: there the link is a pill button, and the chevron says "goes somewhere". */}
              <span className="rp-link-chev" aria-hidden>
                <Icon name="chevronRight" size={15} />
              </span>
            </Link>
          </div>
          {preview.length === 0 ? (
            <ReportEmpty icon="clock" title={scoped ? t.stats.emptyYourQueue : t.stats.emptyQueue} />
          ) : (
            <ReportQueuePreview cards={preview} seats={seats} category={me.business.category} />
          )}
        </section>
      ) : null}
    </div>
  );
}
