import Link from "next/link";
import BarList from "@/components/BarList";
import GlobalSearch from "@/components/GlobalSearch";
import KpiCard from "@/components/KpiCard";
import RevenueTrendChart from "@/components/charts/RevenueTrendChart";
import { formatAmount, formatCount, formatDate, isOlderThanDays } from "@/lib/format";
import { getPlatformOverview, listBusinessesWithMetrics } from "@/lib/server-api";
import { PREMIUM_PLAN_PRICE_INR, STATIC_ACTIVITY_FEED, STATIC_ATTENTION_ITEMS, staticRevenueTrend } from "@/lib/static-data";

export const dynamic = "force-dynamic";

const QUIET_DAYS = 30;

export default async function PlatformDashboardPage() {
  const [overview, storesWithMetrics] = await Promise.all([getPlatformOverview(), listBusinessesWithMetrics()]);

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
  const attentionItems = [
    ...(quietCount > 0 ? [`${quietCount} store${quietCount === 1 ? "" : "s"} quiet ${QUIET_DAYS}d+`] : []),
    ...STATIC_ATTENTION_ITEMS,
  ];

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
        <KpiCard label="Visits today" value={formatCount(today.visits)} sub={`${today.onlineBookings} online bookings`} />
        <KpiCard
          label="MRR"
          value={formatAmount(mrr, "INR")}
          sub={`${premiumCount} premium × ${formatAmount(PREMIUM_PLAN_PRICE_INR, "INR")}`}
        />
      </div>

      <div className="chart-grid" style={{ marginBottom: 18 }}>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>
            Platform revenue — 30d <span className="chart-tag">Sample data</span>
          </h2>
          {/* No real cross-store revenue series exists (stores may use different currencies). */}
          <RevenueTrendChart data={staticRevenueTrend()} currency="INR" />
        </div>
        <div className="chart-card" style={{ marginBottom: 0 }}>
          <h2>
            Activity <span className="chart-tag">Sample data</span>
          </h2>
          <div className="feed-list">
            {STATIC_ACTIVITY_FEED.map((item) => (
              <div key={item.text} className="feed-item">
                <span className="feed-dot" />
                <span>{item.text}</span>
                <span className="feed-time">{item.time}</span>
              </div>
            ))}
          </div>
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
