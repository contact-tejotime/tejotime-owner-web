import Link from "next/link";
import BarList from "@/components/BarList";
import KpiCard from "@/components/KpiCard";
import { RevenueTrendChart, SourcePie, VisitsBarChart } from "@/components/charts/lazy";
import { formatCount, formatMoneyCompact, formatPercent, rupees } from "@/lib/format";
import { getStoreAnalytics } from "@/lib/server-api";

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
    return <div className="alert err">Could not load analytics — is the backend running?</div>;
  }

  const { today, allTime } = analytics;
  const series = analytics.revenueByDay.map((p) => ({ date: p.date, value: rupees(p.revenue) }));
  const visitSeries = analytics.revenueByDay.map((p) => ({ date: p.date, value: p.visits }));

  return (
    <>
      <div className="side-label" style={{ padding: "0 0 8px" }}>
        Today
      </div>
      <div className="kpi-grid">
        <KpiCard label="Appointments" value={formatCount(today.appointments)} sub="booked for today" />
        <KpiCard label="Active in queue" value={formatCount(today.activeQueue)} sub="waiting + in service" />
        <KpiCard label="Completed" value={formatCount(today.completed)} sub="visits today" />
        <KpiCard label="Revenue today" value={formatMoneyCompact(today.revenue)} />
      </div>

      <div className="side-label" style={{ padding: "0 0 8px" }}>
        All time
      </div>
      <div className="kpi-grid">
        <KpiCard label="Customers" value={formatCount(allTime.customers)} />
        <KpiCard label="Visits" value={formatCount(allTime.visits)} />
        <KpiCard label="Revenue" value={formatMoneyCompact(allTime.revenue)} />
        <KpiCard label="Avg ticket" value={formatMoneyCompact(allTime.avgTicket)} />
        <KpiCard label="Repeat rate" value={formatPercent(allTime.repeatRate)} sub="2+ visits" />
        <KpiCard label="VIPs" value={formatCount(allTime.vipCount)} />
      </div>

      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Revenue — last {range === "30d" ? "30" : "90"} days</h2>
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
          <h2>Visits per day</h2>
          <VisitsBarChart data={visitSeries} />
        </div>
        <div className="chart-card">
          <h2>Walk-in vs online ({range})</h2>
          <SourcePie walkIn={analytics.visitSources.walkIn} online={analytics.visitSources.online} />
        </div>
        <div className="chart-card">
          <h2>Top services by revenue ({range})</h2>
          <BarList
            emptyText="No visits in this period yet"
            rows={analytics.topServices.map((s) => ({
              label: s.name,
              sub: `${s.visits} visit${s.visits === 1 ? "" : "s"}`,
              value: s.revenue.amount,
              display: formatMoneyCompact(s.revenue),
            }))}
          />
        </div>
        <div className="chart-card">
          <h2>Top staff by revenue ({range})</h2>
          <BarList
            emptyText="No visits in this period yet"
            rows={analytics.topStaff.map((s) => ({
              label: s.name,
              sub: `${s.visits} visit${s.visits === 1 ? "" : "s"}`,
              value: s.revenue.amount,
              display: formatMoneyCompact(s.revenue),
            }))}
          />
        </div>
      </div>
    </>
  );
}
