import Link from "next/link";
import BarList from "@/components/BarList";
import GlobalSearch from "@/components/GlobalSearch";
import KpiCard from "@/components/KpiCard";
import CountBarChart from "@/components/charts/CountBarChart";
import { bucketByMonth, formatAmount, formatCount, formatDate, isOlderThanDays } from "@/lib/format";
import { getPlatformOverview, listBusinessesWithMetrics, listPlatformCustomers } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR } from "@/lib/static-data";

export const dynamic = "force-dynamic";

const QUIET_DAYS = 30;

export default async function PlatformDashboardPage() {
  const [overview, storesWithMetrics, { customers }] = await Promise.all([
    getPlatformOverview(),
    listBusinessesWithMetrics(),
    listPlatformCustomers(),
  ]);

  if (!overview) {
    return (
      <div className="wrap">
        <div className="page-head">
          <h1>Dashboard</h1>
        </div>
        <div className="alert err">Could not load platform analytics — is the backend running?</div>
      </div>
    );
  }

  const { stores, today } = overview;

  const premiumCount = storesWithMetrics.filter((s) => s.plan === "premium").length;
  const mrr = premiumCount * PREMIUM_PLAN_PRICE_INR;

  const quietCount = storesWithMetrics.filter(
    (s) => s.isActive && isOlderThanDays(s.lastActivityAt, QUIET_DAYS),
  ).length;
  const attentionItems =
    quietCount > 0 ? [`${quietCount} store${quietCount === 1 ? "" : "s"} quiet ${QUIET_DAYS}d+`] : [];

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Platform overview · {formatDate(overview.date)}</p>
      </div>

      <div className="toolbar-row">
        <GlobalSearch />
        <Link href="/" className="btn-primary">
          + Create store
        </Link>
      </div>

      {attentionItems.length > 0 && (
        <div className="banner-attention">
          <b>Needs attention</b> — {attentionItems.join(" · ")} · <Link href="/stores">Review stores</Link>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard
          label="Stores"
          value={formatCount(stores.total)}
          sub={`${stores.active} active${stores.inactive > 0 ? ` · ${stores.inactive} inactive` : ""}`}
        />
        <KpiCard label="Customers" value={formatCount(overview.totalCustomers)} sub="all stores" />
        <KpiCard label="Visits today" value={formatCount(today.visits)} />
        <KpiCard
          label="MRR"
          value={formatAmount(mrr, "INR")}
          sub={`${premiumCount} premium × ${formatAmount(PREMIUM_PLAN_PRICE_INR, "INR")}`}
        />
      </div>

      <div className="chart-grid" style={{ marginBottom: 18 }}>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>Store signups — 12 months</h2>
          <CountBarChart data={bucketByMonth(storesWithMetrics.map((s) => s.createdAt))} name="Stores created" />
        </div>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>New customers — 12 months</h2>
          <CountBarChart data={bucketByMonth(customers.map((c) => c.createdAt))} name="New customers" />
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h2>Stores by city</h2>
          <BarList
            emptyText="No stores yet"
            rows={overview.storesByCity.map((c) => ({ label: c.city ?? "Unknown", value: c.count }))}
          />
        </div>
        <div className="chart-card">
          <h2>Stores by category</h2>
          <BarList
            emptyText="No stores yet"
            rows={overview.storesByCategory.map((c) => ({ label: c.category ?? "Uncategorised", value: c.count }))}
          />
        </div>
      </div>
    </div>
  );
}
