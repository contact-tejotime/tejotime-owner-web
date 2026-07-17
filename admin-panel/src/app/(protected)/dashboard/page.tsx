import Link from "next/link";
import BarList from "@/components/BarList";
import GlobalSearch from "@/components/GlobalSearch";
import KpiCard from "@/components/KpiCard";
import { CountBarChart } from "@/components/charts/lazy";
import { bucketByMonth, formatAmount, formatCount, formatDate, isOlderThanDays } from "@/lib/format";
import { getPlatformOverview, listBusinessesWithMetrics, listPlatformCustomers } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR } from "@/lib/static-data";
import { t, format } from "@/i18n";

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
          <h1>{t.dashboard.title}</h1>
        </div>
        <div className="alert err">{t.dashboard.loadError}</div>
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
    quietCount > 0
      ? [format(quietCount === 1 ? t.dashboard.quietStoresOne : t.dashboard.quietStores, { count: quietCount, days: QUIET_DAYS })]
      : [];

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.dashboard.title}</h1>
        <p>{format(t.dashboard.overview, { date: formatDate(overview.date) })}</p>
      </div>

      <div className="toolbar-row">
        <GlobalSearch />
        <Link href="/" className="btn-primary">
          {t.dashboard.createStore}
        </Link>
      </div>

      {attentionItems.length > 0 && (
        <div className="banner-attention">
          <b>{t.dashboard.needsAttention}</b> — {attentionItems.join(" · ")} ·{" "}
          <Link href="/stores">{t.dashboard.reviewStores}</Link>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard
          label={t.dashboard.kpiStores}
          value={formatCount(stores.total)}
          sub={format(stores.inactive > 0 ? t.dashboard.kpiStoresSubInactive : t.dashboard.kpiStoresSub, {
            active: stores.active,
            inactive: stores.inactive,
          })}
        />
        <KpiCard label={t.dashboard.kpiCustomers} value={formatCount(overview.totalCustomers)} sub={t.dashboard.kpiCustomersSub} />
        <KpiCard label={t.dashboard.kpiVisitsToday} value={formatCount(today.visits)} />
        <KpiCard
          label={t.dashboard.kpiMrr}
          value={formatAmount(mrr, "INR")}
          sub={format(t.dashboard.kpiMrrSub, { count: premiumCount, price: formatAmount(PREMIUM_PLAN_PRICE_INR, "INR") })}
        />
      </div>

      <div className="chart-grid" style={{ marginBottom: 18 }}>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>{t.dashboard.storeSignups}</h2>
          <CountBarChart data={bucketByMonth(storesWithMetrics.map((s) => s.createdAt))} name={t.dashboard.storesCreated} />
        </div>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>{t.dashboard.newCustomers}</h2>
          <CountBarChart data={bucketByMonth(customers.map((c) => c.createdAt))} name={t.dashboard.newCustomersSeries} />
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h2>{t.dashboard.storesByCity}</h2>
          <BarList
            emptyText={t.dashboard.noStoresYet}
            rows={overview.storesByCity.map((c) => ({ label: c.city ?? t.dashboard.unknownCity, value: c.count }))}
          />
        </div>
        <div className="chart-card">
          <h2>{t.dashboard.storesByCategory}</h2>
          <BarList
            emptyText={t.dashboard.noStoresYet}
            rows={overview.storesByCategory.map((c) => ({ label: c.category ?? t.dashboard.uncategorised, value: c.count }))}
          />
        </div>
      </div>
    </div>
  );
}
