import DateRangeFilter from "@/components/DateRangeFilter";
import { formatCount, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";
import { listStoreVisits } from "@/lib/server-api";
import { t, format } from "@/i18n";

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
    return <div className="alert err">{t.storeVisits.loadError}</div>;
  }

  return (
    <>
      <DateRangeFilter from={visits.from} to={visits.to} />

      <div className="summary-bar">
        <span>
          {t.storeVisits.visits} <b>{formatCount(visits.summary.visits)}</b>
        </span>
        <span>
          {t.storeVisits.revenue} <b>{formatMoneyCompact(visits.summary.revenue)}</b>
        </span>
        <span>
          {t.storeVisits.avgTicket} <b>{formatMoney(visits.summary.avgTicket)}</b>
        </span>
      </div>

      <div className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.storeVisits.colWhen}</th>
                <th>{t.storeVisits.colCustomer}</th>
                <th>{t.storeVisits.colService}</th>
                <th>{t.storeVisits.colStaff}</th>
                <th className="num">{t.storeVisits.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {visits.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-note">
                    {t.storeVisits.emptyPeriod}
                  </td>
                </tr>
              )}
              {visits.data.map((v) => (
                <tr key={v.id}>
                  <td>{formatDateTime(v.completedAt)}</td>
                  <td className="nm">{v.customerName}</td>
                  <td>{v.serviceName || t.common.unknown}</td>
                  <td>{v.staffName || t.common.dash}</td>
                  <td className="num">{formatMoney(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visits.meta.total > visits.meta.shown && (
          <p className="table-note">
            {format(t.storeVisits.truncated, { shown: visits.meta.shown, total: formatCount(visits.meta.total) })}
          </p>
        )}
      </div>
    </>
  );
}
