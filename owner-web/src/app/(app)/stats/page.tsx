import Link from "next/link";
import type { CSSProperties } from "react";
import { t, format, plural } from "@/i18n";
import { redirect } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon, type IconName } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScopeNotice } from "@/components/ScopeNotice";
import {
  formatDayKey,
  formatRate,
  parseReportQuery,
  reportQueryString,
  type ReportQuery,
  type ReportRange,
} from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import { can, NO_ACCESS } from "@/lib/roles";
import {
  getCommissionSummary,
  getCommissionVisits,
  getDashboard,
  getDashboardByStaff,
  getMe,
  getQueue,
  type CommissionStaffRow,
  type DashboardStaffRow,
} from "@/lib/server-api";
import { gridColumnVars } from "./columns";
import { segmentBreakdown } from "./commission-text";
import { CommissionVisitsSheet } from "./CommissionVisitsSheet";
import { ReportQueuePreview } from "./ReportQueuePreview";
import "@/styles/reports.css";

const RANGE_LABELS: Record<ReportRange, string> = {
  today: t.stats.today,
  week: t.stats.thisWeek,
  month: t.stats.thisMonth,
  custom: t.stats.custom,
};

const RANGE_EYEBROWS: Record<ReportRange, string> = {
  today: t.stats.today,
  week: t.stats.thisWeek,
  month: t.stats.thisMonth,
  custom: t.stats.customRange,
};

const STAFF_LEADS: Record<ReportRange, string> = {
  today: t.stats.leadToday,
  week: t.stats.leadWeek,
  month: t.stats.leadMonth,
  custom: t.stats.leadCustom,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** A small KPI tile in the metric-tile style (same `kpi-card` desktop treatment as the row above). */
function Tile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="rp-metric kpi-card" role="group" aria-label={`${label}: ${value}`}>
      <span className="rp-metric-icon kpi-card-icon" aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <span className="rp-metric-figures kpi-card-text" aria-hidden>
        <span className="rp-metric-value kpi-card-value">{value}</span>
        <span className="rp-metric-label kpi-card-label">{label}</span>
      </span>
    </div>
  );
}

/** A stylist's commission inside their breakdown card: the figure, then the period rate by rate. */
function StaffCommission({ row }: { row: CommissionStaffRow }) {
  return (
    <div className="rp-comm">
      <div className="rp-comm-row">
        <span className="rp-comm-label">{t.stats.colCommission}</span>
        <span className="rp-comm-value">{formatMoney(row.commission)}</span>
      </div>
      {row.segments.length ? <p className="rp-comm-break">{segmentBreakdown(row.segments)}</p> : null}
    </div>
  );
}

/**
 * Reports — the same screen as the app's Reports tab (app/src/app/(app)/(tabs)/stats.tsx), in the
 * same order: the period switch (Today / This week / This month / Custom), the revenue card on the
 * store's brand colour, the metric tiles, commission (owners), the staff breakdown (store-wide
 * roles only), a stylist's own earnings (every staff login), then the queue preview
 * on Today.
 *
 * Staff see their own chair only — the API narrows every figure — so their card says "My report"
 * and "Your revenue", and they get no staff breakdown (the API would 403 it anyway).
 *
 * Commission is every visit at the rate of its own day (docs/staff-commission.md): the breakdown
 * line on a card shows the period rate by rate, so a change on the 16th visibly paid the first
 * fortnight at the old rate. `?staff=<id>` opens that stylist's visits in a sheet.
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; staff?: string }>;
}) {
  const params = await searchParams;
  const query: ReportQuery = parseReportQuery(params);
  const range = query.range;

  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const showDashboard = can(access, "dashboard");
  const showCommission = can(access, "commission");
  const canSetRates = can(access, "commission", "manage");
  const showQueue = can(access, "queue");
  const scoped = me.user.role === "staff";
  const showByStaff = showDashboard && !scoped;
  const drillStaff = showCommission && params.staff && UUID.test(params.staff) ? params.staff : null;

  const [dashboard, byStaff, queue, commission, visits] = await Promise.all([
    showDashboard ? getDashboard(query) : Promise.resolve(null),
    showByStaff ? getDashboardByStaff(query) : Promise.resolve(null),
    showQueue && range === "today" ? getQueue() : Promise.resolve(null),
    showCommission ? getCommissionSummary(query) : Promise.resolve(null),
    drillStaff ? getCommissionVisits(drillStaff, query) : Promise.resolve(null),
  ]);
  const kpis = dashboard?.kpis;
  const staffRows = sortStaff(byStaff?.data ?? []);
  const seats = queue?.seats ?? [];

  // The store's today and the period's days come from the API (the server renders in UTC, which
  // is the wrong day for an Indian store's first 5½ hours). The UTC date only if both calls failed.
  const today = commission?.today ?? dashboard?.today ?? new Date().toISOString().slice(0, 10);
  const windowFrom = commission?.from ?? dashboard?.from ?? query.from ?? today;
  const windowTo = commission?.to ?? dashboard?.to ?? query.to ?? today;
  const periodQs = reportQueryString(query);
  const drillHref = (staffId: string) => `/stats?${periodQs}&staff=${encodeURIComponent(staffId)}`;

  // Seat order, then each seat's own order (serving first, then the line) — the app's
  // `flatCards(seats).slice(0, 3)`, so both surfaces preview the same three people.
  const preview = seats.flatMap((seat) => seat.cards).slice(0, 3);

  const subtitle =
    dashboard?.periodLabel ??
    commission?.periodLabel ??
    (range === "month" ? t.stats.monthToDate : t.stats.todayAtAGlance);
  const rangeEyebrow = RANGE_EYEBROWS[range];
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

  // Commission, owner's view: the store's totals, and each stylist's line for the breakdown cards.
  const storeCommission = commission?.scope === "store" && commission.staff.length > 0 ? commission : null;
  const commissionByStaff = new Map((storeCommission?.staff ?? []).map((row) => [row.staffId, row]));
  const unrated = storeCommission?.staff.reduce((n, row) => n + row.unratedVisits, 0) ?? 0;
  const noRatesAnywhere =
    !!storeCommission && storeCommission.staff.every((row) => row.currentRateBp == null && row.nextRate == null);
  // A stylist's own view (a staff login the owner has shown its earnings to).
  const own = commission?.scope === "self" ? (commission.staff[0] ?? null) : null;

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
        {(Object.keys(RANGE_LABELS) as ReportRange[]).map((key) => (
          <Link
            key={key}
            // Custom opens on the dates already on screen, so switching from "This week" to
            // Custom starts from that week rather than from nothing.
            href={
              key === "custom"
                ? `/stats?${reportQueryString({ range: "custom", from: windowFrom, to: windowTo })}`
                : `/stats?range=${key}`
            }
            scroll={false}
            className={`rp-range-btn${range === key ? " is-active" : ""}`}
            role="tab"
            aria-selected={range === key}
          >
            {RANGE_LABELS[key]}
          </Link>
        ))}
      </div>

      {/* Custom dates: a plain GET form, so it needs no client JavaScript and the period stays in
          the URL like every other one. Store-local days; nothing past the store's today. */}
      {range === "custom" ? (
        <form className="rp-custom" method="get" action="/stats" aria-label={t.stats.customAria}>
          <input type="hidden" name="range" value="custom" />
          <label className="rp-custom-field">
            <span className="rp-custom-label">{t.stats.customFrom}</span>
            <input type="date" name="from" defaultValue={windowFrom} max={today} required />
          </label>
          <label className="rp-custom-field">
            <span className="rp-custom-label">{t.stats.customTo}</span>
            <input type="date" name="to" defaultValue={windowTo} max={today} required />
          </label>
          <button type="submit" className="rp-custom-apply">
            {t.stats.customApply}
          </button>
        </form>
      ) : null}

      {showDashboard ? (
        /* On a phone: the app's brand revenue card over a row of tiles. On desktop the same markup
           becomes one row of equal `kpi-card`s — revenue plus the tiles — styled exactly like
           Home's live-queue cards (globals.css), at the owner's request: a wide brand banner beside
           three small tiles read as unrelated blocks. `--rp-cols` is 4 on Today, 3 otherwise;
           `--rp-cols-md` is the narrow-desktop count (four cards don't fit beside the sidebar). */
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
      ) : null}

      {storeCommission ? (
        <section className="rp-section" aria-labelledby="rp-comm-title">
          <div className="rp-section-head">
            <h2 id="rp-comm-title" className="home-section-title">
              {t.stats.commissionTitle}
            </h2>
            {canSetRates ? (
              <Link href="/settings/commission" className="rp-link">
                {t.stats.commissionSetRates}
                <span className="rp-link-chev" aria-hidden>
                  <Icon name="chevronRight" size={15} />
                </span>
              </Link>
            ) : null}
          </div>
          <p className="rp-lead">{t.stats.commissionLead}</p>
          <div className="rp-comm-tiles">
            <Tile icon="percent" label={t.stats.commissionTotal} value={formatMoney(storeCommission.totals.commission)} />
            <Tile icon="wallet" label={t.stats.salonKeeps} value={formatMoney(storeCommission.totals.salonKeeps)} />
          </div>
          {noRatesAnywhere || unrated > 0 || (storeCommission.unassigned?.visits ?? 0) > 0 ? (
            <ul className="rp-comm-notes">
              {noRatesAnywhere ? <li>{t.stats.commissionNoRates}</li> : null}
              {!noRatesAnywhere && unrated > 0 ? (
                <li>{plural(unrated, t.stats.commissionUnratedOne, t.stats.commissionUnrated)}</li>
              ) : null}
              {(storeCommission.unassigned?.visits ?? 0) > 0 ? (
                <li>
                  {format(t.stats.commissionUnassigned, {
                    revenue: formatMoney(storeCommission.unassigned!.revenue),
                  })}
                </li>
              ) : null}
            </ul>
          ) : null}
        </section>
      ) : null}

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
          <p className="rp-lead">{STAFF_LEADS[range]}</p>

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
                const earned = commissionByStaff.get(row.staffId);
                const body = (
                  <>
                    <div className="rp-staff-id">
                      <span className="rp-staff-avatar" aria-hidden>
                        {initials(row.name)}
                      </span>
                      <h3 className="rp-staff-name">{row.name}</h3>
                      {row.isActive === false ? <span className="rp-tag">{t.stats.removedTag}</span> : null}
                      {earned ? (
                        <span className={`rp-rate${earned.currentRateBp == null ? " is-none" : ""}`}>
                          {earned.currentRateBp == null ? t.stats.rateNone : formatRate(earned.currentRateBp)}
                        </span>
                      ) : null}
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

                    {earned ? <StaffCommission row={earned} /> : null}
                  </>
                );
                // With commission in view the card opens that stylist's visits, each at its day's rate.
                return earned ? (
                  <Link
                    key={row.staffId}
                    href={drillHref(row.staffId)}
                    scroll={false}
                    className={`rp-staff rp-staff--link${top ? " is-top" : ""}`}
                    aria-label={`${row.name} — ${t.stats.viewVisits}`}
                  >
                    {body}
                  </Link>
                ) : (
                  <article key={row.staffId} className={`rp-staff${top ? " is-top" : ""}`}>
                    {body}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {scoped && showCommission ? (
        <section className="rp-section" aria-labelledby="rp-earn-title">
          <div className="rp-section-head">
            <h2 id="rp-earn-title" className="home-section-title">
              {t.stats.myEarnings}
            </h2>
            {own && me.user.staffId ? (
              <Link href={drillHref(me.user.staffId)} scroll={false} className="rp-link">
                {t.stats.viewVisits}
                <span className="rp-link-chev" aria-hidden>
                  <Icon name="chevronRight" size={15} />
                </span>
              </Link>
            ) : null}
          </div>
          <p className="rp-lead">{t.stats.myEarningsLead}</p>
          {own ? (
            <article className="rp-earn">
              <p className="rp-earn-value">{formatMoney(own.commission)}</p>
              <p className="rp-earn-label">{t.stats.earned}</p>
              <p className="rp-earn-rate">
                {own.currentRateBp != null && own.currentRateFrom
                  ? format(t.stats.yourRate, {
                      rate: formatRate(own.currentRateBp),
                      day: formatDayKey(own.currentRateFrom, { year: true }),
                    })
                  : t.stats.yourRateNone}
              </p>
              {own.segments.length ? <p className="rp-comm-break">{segmentBreakdown(own.segments)}</p> : null}
            </article>
          ) : (
            <ReportEmpty icon="percent" title={t.stats.yourRateNone} />
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

      {drillStaff ? <CommissionVisitsSheet data={visits} closeHref={`/stats?${periodQs}`} /> : null}
    </div>
  );
}
