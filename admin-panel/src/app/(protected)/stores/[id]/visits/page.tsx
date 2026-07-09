import DateRangeFilter from "@/components/DateRangeFilter";
import { formatCount, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";
import { listStoreVisits } from "@/lib/server-api";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v?: string) => (v && DATE_RE.test(v) ? v : undefined);

export default async function StoreVisitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const visits = await listStoreVisits(id, clean(sp.from), clean(sp.to));

  if (!visits) {
    return <div className="alert err">Could not load visits — is the backend running?</div>;
  }

  return (
    <>
      <DateRangeFilter from={visits.from} to={visits.to} />

      <div className="summary-bar">
        <span>
          Visits: <b>{formatCount(visits.summary.visits)}</b>
        </span>
        <span>
          Revenue: <b>{formatMoneyCompact(visits.summary.revenue)}</b>
        </span>
        <span>
          Avg ticket: <b>{formatMoney(visits.summary.avgTicket)}</b>
        </span>
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Service</th>
                <th>Staff</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visits.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-note">
                    No visits in this period
                  </td>
                </tr>
              )}
              {visits.data.map((v) => (
                <tr key={v.id}>
                  <td>{formatDateTime(v.completedAt)}</td>
                  <td className="nm">{v.customerName}</td>
                  <td>{v.serviceName || "(unknown)"}</td>
                  <td>{v.staffName || "—"}</td>
                  <td className="num">{formatMoney(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visits.meta.total > visits.meta.shown && (
          <p className="table-note">
            Showing the {visits.meta.shown} most recent of {formatCount(visits.meta.total)} visits — narrow the
            date range to see the rest. Summary covers the full range.
          </p>
        )}
      </div>
    </>
  );
}
