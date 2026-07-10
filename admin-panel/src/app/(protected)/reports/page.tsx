import Link from "next/link";
import DateRangeFilter from "@/components/DateRangeFilter";
import ReportsExplorer, {
  type CustomerReportRow,
  type RevenueReportRow,
  type VisitReportRow,
} from "@/components/ReportsExplorer";
import { listPlatformCustomers, listStoreVisits } from "@/lib/server-api";

export const dynamic = "force-dynamic";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reports — real, filterable, exportable views over revenue, customers and
 * visits across all stores. Tab + date range live in the querystring (server
 * refetch); the search and store filter are client-side in ReportsExplorer.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const report =
    sp.report === "visits"
      ? ("visits" as const)
      : sp.report === "customers"
        ? ("customers" as const)
        : ("revenue" as const);

  // All reports default to the last 30 days, shown in the date inputs so the
  // covered window is always visible. The customer report's dates filter by
  // last-visit date — widen the range to reach older or zero-visit customers.
  let from = sp.from ?? "";
  let to = sp.to ?? "";
  if (!from && !to) {
    const now = new Date();
    to = isoDate(now);
    from = isoDate(new Date(now.getTime() - 30 * 86_400_000));
  }

  const { customers, stores } = await listPlatformCustomers();

  let revenueRows: RevenueReportRow[] = [];
  let customerRows: CustomerReportRow[] = [];
  let visitRows: VisitReportRow[] = [];

  if (report === "customers") {
    customerRows = customers
      .filter((c) => {
        const last = c.lastVisitAt?.slice(0, 10) ?? "";
        if (from && (!last || last < from)) return false;
        if (to && (!last || last > to)) return false;
        return true;
      })
      .map((c) => ({
        key: c.key,
        name: c.name,
        phone: c.phone,
        storeIds: c.memberships.map((m) => m.storeId),
        storeLabel:
          c.memberships.length > 1
            ? `${c.memberships[0].storeName} +${c.memberships.length - 1}`
            : c.memberships[0].storeName,
        visitsCount: c.visitsCount,
        totalSpend: c.totalSpend,
      }));
  } else {
    // Revenue and visits both need the per-store visits fetch (its summary is
    // range-accurate even when the row list is truncated).
    const perStore = await Promise.all(
      stores.map(async (s) => ({ store: s, res: await listStoreVisits(s.id, from || undefined, to || undefined) })),
    );

    if (report === "revenue") {
      revenueRows = perStore
        .flatMap(({ store, res }) =>
          res
            ? [{ storeId: store.id, storeName: store.name || "(unnamed)", visits: res.summary.visits, revenue: res.summary.revenue }]
            : [],
        )
        .sort((a, b) => b.revenue.amount - a.revenue.amount);
    } else {
      // Visits carry customerId but no phone — join it from the customers aggregation.
      const phoneByCustomerId = new Map<string, string>();
      for (const c of customers) for (const m of c.memberships) phoneByCustomerId.set(m.customerId, c.phone);

      visitRows = perStore
        .flatMap(({ store, res }) =>
          (res?.data ?? []).map((v) => ({
            id: v.id,
            name: v.customerName,
            phone: (v.customerId && phoneByCustomerId.get(v.customerId)) || "—",
            storeId: store.id,
            storeName: store.name || "(unnamed)",
            completedAt: v.completedAt,
            serviceName: v.serviceName,
            amount: v.amount,
          })),
        )
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    }
  }

  const dateQs = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Reports</h1>
        <p>Revenue, customer and visit data across all stores · filter, then export as CSV</p>
      </div>

      <div className="filter-row">
        <div className="range-toggle">
          <Link href={`/reports?report=revenue${dateQs}`} className={report === "revenue" ? "active" : ""}>
            Revenue
          </Link>
          <Link href={`/reports?report=customers${dateQs}`} className={report === "customers" ? "active" : ""}>
            Customer
          </Link>
          <Link href={`/reports?report=visits${dateQs}`} className={report === "visits" ? "active" : ""}>
            Customer visit
          </Link>
        </div>
      </div>

      {/* Keyed so the draft inputs re-sync when the applied range changes (the
          component keeps its drafts in state, which survives client navigations). */}
      <DateRangeFilter key={`${from}|${to}`} from={from} to={to} />

      <ReportsExplorer report={report} revenue={revenueRows} customers={customerRows} visits={visitRows} stores={stores} />
    </div>
  );
}
