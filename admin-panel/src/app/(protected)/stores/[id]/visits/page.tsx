import DateRangeFilter from "@/components/DateRangeFilter";
import {
  formatCount,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  formatRate,
} from "@/lib/format";
import { getStoreCommission, listStoreVisits } from "@/lib/server-api";
import type { CommissionSegment } from "@/lib/types";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v?: string) => (v && DATE_RE.test(v) ? v : undefined);

/** A store-local `YYYY-MM-DD` day → "2 Oct", on the calendar (no timezone shift). */
function day(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function segmentText(seg: CommissionSegment): string {
  return seg.rateBp == null
    ? format(t.storeVisits.segmentUnrated, { from: day(seg.from), to: day(seg.to) })
    : format(t.storeVisits.segmentRated, {
        rate: formatRate(seg.rateBp),
        from: day(seg.from),
        to: day(seg.to),
        commission: formatMoney(seg.commission),
      });
}

/**
 * A store's visit ledger, with each visit's commission (the rate of its own day) and a read-only
 * "Commission by stylist" summary for the same dates. Admins never set rates — the store owner
 * does, in owner-web or the app. See docs/staff-commission.md.
 */
export default async function StoreVisitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [visits, commission] = await Promise.all([
    listStoreVisits(id, clean(sp.from), clean(sp.to)),
    getStoreCommission(id, clean(sp.from), clean(sp.to)),
  ]);

  if (!visits) {
    return <div className="alert err">{t.storeVisits.loadError}</div>;
  }

  const anyRate = commission?.staff.some((s) => s.currentRateBp != null || s.segments.some((g) => g.rateBp != null));

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
        {visits.summary.commission ? (
          <span>
            {t.storeVisits.commission} <b>{formatMoneyCompact(visits.summary.commission)}</b>
          </span>
        ) : null}
        {visits.summary.salonKeeps ? (
          <span>
            {t.storeVisits.salonKeeps} <b>{formatMoneyCompact(visits.summary.salonKeeps)}</b>
          </span>
        ) : null}
      </div>

      {commission && commission.staff.length > 0 ? (
        <div className="section">
          <h2>{t.storeVisits.commissionTitle}</h2>
          <p className="hint">{t.storeVisits.commissionLead}</p>
          {!anyRate ? <p className="hint">{t.storeVisits.commissionNoRates}</p> : null}
          <div className="table-wrap">
            <table className="store-table">
              <thead>
                <tr>
                  <th>{t.storeVisits.colStylist}</th>
                  <th className="num">{t.storeVisits.colVisits}</th>
                  <th className="num">{t.storeVisits.colRevenue}</th>
                  <th>{t.storeVisits.colPeriods}</th>
                  <th className="num">{t.storeVisits.colCommission}</th>
                  <th className="num">{t.storeVisits.colCurrentRate}</th>
                </tr>
              </thead>
              <tbody>
                {commission.staff.map((s) => (
                  <tr key={s.staffId}>
                    <td className="nm">
                      {s.name}
                      {s.isActive ? null : ` (${t.storeVisits.removedTag})`}
                    </td>
                    <td className="num">{formatCount(s.visits)}</td>
                    <td className="num">{formatMoney(s.revenue)}</td>
                    <td>{s.segments.length ? s.segments.map(segmentText).join(" · ") : t.common.dash}</td>
                    <td className="num">{formatMoney(s.commission)}</td>
                    <td className="num">{formatRate(s.currentRateBp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {commission.unassigned && commission.unassigned.visits > 0 ? (
            <p className="table-note">
              {format(t.storeVisits.commissionUnassigned, { revenue: formatMoney(commission.unassigned.revenue) })}
            </p>
          ) : null}
        </div>
      ) : null}

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
                <th className="num">{t.storeVisits.colRate}</th>
                <th className="num">{t.storeVisits.colCommission}</th>
              </tr>
            </thead>
            <tbody>
              {visits.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-note">
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
                  <td className="num">{formatRate(v.rateBp)}</td>
                  <td className="num">{v.commission ? formatMoney(v.commission) : t.common.dash}</td>
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
