import Link from "next/link";
import BarList from "@/components/BarList";
import KpiCard from "@/components/KpiCard";
import { RevenueTrendChart, SourcePie, VisitsBarChart } from "@/components/charts/lazy";
import { formatCount, formatMoneyCompact, formatPercent, rupees } from "@/lib/format";
import { getStoreAnalytics } from "@/lib/server-api";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function StoreOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const rangeParam = (await searchParams).range;
  const range: "30d" | "90d" = rangeParam === "30d" ? "30d" : "90d";

  const analytics = await getStoreAnalytics(id, range);
  if (!analytics) {
    return <div className="alert err">{t.storeOverview.loadError}</div>;
  }

  const { today, allTime } = analytics;
  const series = analytics.revenueByDay.map((p) => ({ date: p.date, value: rupees(p.revenue) }));
  const visitSeries = analytics.revenueByDay.map((p) => ({ date: p.date, value: p.visits }));

  return (
    <>
      <div className="side-label" style={{ padding: "0 0 8px" }}>
        {t.storeOverview.today}
      </div>
      <div className="kpi-grid">
        <KpiCard label={t.storeOverview.appointments} value={formatCount(today.appointments)} sub={t.storeOverview.appointmentsSub} />
        <KpiCard label={t.storeOverview.activeQueue} value={formatCount(today.activeQueue)} sub={t.storeOverview.activeQueueSub} />
        <KpiCard label={t.storeOverview.completed} value={formatCount(today.completed)} sub={t.storeOverview.completedSub} />
        <KpiCard label={t.storeOverview.revenueToday} value={formatMoneyCompact(today.revenue)} />
      </div>

      <div className="side-label" style={{ padding: "0 0 8px" }}>
        {t.storeOverview.allTime}
      </div>
      <div className="kpi-grid">
        <KpiCard label={t.storeOverview.customers} value={formatCount(allTime.customers)} />
        <KpiCard label={t.storeOverview.visits} value={formatCount(allTime.visits)} />
        <KpiCard label={t.storeOverview.revenue} value={formatMoneyCompact(allTime.revenue)} />
        <KpiCard label={t.storeOverview.avgTicket} value={formatMoneyCompact(allTime.avgTicket)} />
        <KpiCard label={t.storeOverview.repeatRate} value={formatPercent(allTime.repeatRate)} sub={t.storeOverview.repeatRateSub} />
        <KpiCard label={t.storeOverview.vips} value={formatCount(allTime.vipCount)} />
      </div>

      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{format(t.storeOverview.revenueLast, { days: range === "30d" ? "30" : "90" })}</h2>
          <span className="range-toggle">
            <Link href={`/stores/${id}?range=30d`} className={range === "30d" ? "active" : ""}>
              30d
            </Link>
            <Link href={`/stores/${id}?range=90d`} className={range === "90d" ? "active" : ""}>
              90d
            </Link>
          </span>
        </div>
        <RevenueTrendChart data={series} currency={allTime.revenue.currency} />
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h2>{t.storeOverview.visitsPerDay}</h2>
          <VisitsBarChart data={visitSeries} />
        </div>
        <div className="chart-card">
          <h2>{format(t.storeOverview.walkInVsOnline, { range })}</h2>
          <SourcePie walkIn={analytics.visitSources.walkIn} online={analytics.visitSources.online} />
        </div>
        <div className="chart-card">
          <h2>{format(t.storeOverview.topServices, { range })}</h2>
          <BarList
            emptyText={t.storeOverview.noVisitsPeriod}
            rows={analytics.topServices.map((s) => ({
              label: s.name,
              sub: format(s.visits === 1 ? t.storeOverview.visitCount : t.storeOverview.visitCountPlural, { count: s.visits }),
              value: s.revenue.amount,
              display: formatMoneyCompact(s.revenue),
            }))}
          />
        </div>
        <div className="chart-card">
          <h2>{format(t.storeOverview.topStaff, { range })}</h2>
          <BarList
            emptyText={t.storeOverview.noVisitsPeriod}
            rows={analytics.topStaff.map((s) => ({
              label: s.name,
              sub: format(s.visits === 1 ? t.storeOverview.visitCount : t.storeOverview.visitCountPlural, { count: s.visits }),
              value: s.revenue.amount,
              display: formatMoneyCompact(s.revenue),
            }))}
          />
        </div>
      </div>
    </>
  );
}
