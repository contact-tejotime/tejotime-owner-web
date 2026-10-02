"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { t, format, plural } from "@/i18n";

import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { formatClock, formatDayKey, formatRate } from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import type { CommissionVisit, CommissionVisits } from "@/lib/server-api";
import { segmentBreakdown } from "./commission-text";

/**
 * One stylist's visits for the Reports period, each with the rate of its own day and what it
 * earned — the web twin of the app's `CommissionVisitsSheet`.
 *
 * Opened by the URL (`?staff=<id>`), not by local state: the page fetches the list on the server
 * with the session's own scope (a staff login can only ever get its own chair), LiveRefresh keeps
 * it current after a checkout, and closing is just navigating back to the period without the id.
 *
 * Dates and times are the STORE's, formatted from the API's `localDate` / `localTime` — never from
 * `completedAt`, which would be printed in the server's timezone.
 */
export function CommissionVisitsSheet({ data, closeHref }: { data: CommissionVisits | null; closeHref: string }) {
  const router = useRouter();
  const titleId = useId();
  const close = () => router.replace(closeHref, { scroll: false });

  // Newest first from the API; grouped under one heading per store day.
  const days: [string, CommissionVisit[]][] = [];
  for (const visit of data?.data ?? []) {
    const last = days[days.length - 1];
    if (last && last[0] === visit.localDate) last[1].push(visit);
    else days.push([visit.localDate, [visit]]);
  }

  return (
    <BottomSheet onClose={close} closeLabel={t.commission.close} labelledBy={titleId} className="rp-visits-sheet">
      <div className="rp-visits-head">
        <div className="rp-visits-heading">
          <h2 id={titleId} className="rp-visits-title">
            {data ? data.staff.name : t.stats.commissionTitle}
          </h2>
          {data ? <p className="rp-visits-sub">{data.periodLabel}</p> : null}
        </div>
        <button type="button" className="rp-visits-close" onClick={close} aria-label={t.commission.close}>
          <Icon name="x" size={18} />
        </button>
      </div>

      {!data ? (
        <p className="rp-visits-note">{t.commission.visitsLoadError}</p>
      ) : (
        <>
          <p className="rp-visits-total">
            {plural(data.totals.visits, t.commission.visitsTotalOne, t.commission.visitsTotal, {
              revenue: formatMoney(data.totals.revenue),
              commission: formatMoney(data.totals.commission),
            })}
          </p>
          {data.segments.length ? <p className="rp-comm-break">{segmentBreakdown(data.segments)}</p> : null}

          {data.data.length === 0 ? (
            <p className="rp-visits-note">{t.commission.visitsEmpty}</p>
          ) : (
            <div className="rp-visits-body">
              {days.map(([day, visits]) => (
                <section key={day} className="rp-visits-day">
                  <h3 className="rp-visits-day-title">{formatDayKey(day, { weekday: true })}</h3>
                  <ul className="rp-visits-list">
                    {visits.map((v) => (
                      <li key={v.id} className="rp-visit">
                        <span className="rp-visit-time">{formatClock(v.localTime)}</span>
                        <span className="rp-visit-main">
                          <span className="rp-visit-service">{v.serviceName || t.commission.visitNoService}</span>
                          {v.customerName ? <span className="rp-visit-customer">{v.customerName}</span> : null}
                        </span>
                        <span className="rp-visit-money">
                          <span className="rp-visit-amount">{formatMoney(v.amount)}</span>
                          <span className={`rp-visit-earned${v.rateBp == null ? " is-none" : ""}`}>
                            {v.rateBp == null ? t.stats.rateNone : `${formatRate(v.rateBp)} · ${formatMoney(v.commission)}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {data.meta.shown < data.meta.total ? (
                <p className="rp-visits-note">
                  {format(t.commission.visitsTruncated, { shown: data.meta.shown, total: data.meta.total })}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}
