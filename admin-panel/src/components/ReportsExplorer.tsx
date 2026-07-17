"use client";

import { useMemo, useState } from "react";
import type { Money, StoreListItem } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import { formatCount, formatDateTime, formatMoney, moneyToDecimalString } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { t, format } from "@/i18n";
import { SearchIcon } from "@/components/icons";

export interface CustomerReportRow {
  key: string;
  name: string;
  phone: string;
  storeIds: string[];
  storeLabel: string;
  visitsCount: number;
  totalSpend: Money | null;
}

export interface VisitReportRow {
  id: string;
  name: string;
  phone: string;
  storeId: string;
  storeName: string;
  completedAt: string;
  serviceName: string | null;
  amount: Money;
}

export interface RevenueReportRow {
  storeId: string;
  storeName: string;
  visits: number;
  revenue: Money;
}

/**
 * Client half of the Reports page: search + store filter over the
 * server-fetched rows (per-store revenue totals, customers, or visits), and a
 * CSV export of exactly what's filtered. The report tab and date range live in
 * the querystring (server refetch).
 */
export default function ReportsExplorer({
  report,
  revenue,
  customers,
  visits,
  stores,
  visitsTruncated = false,
}: {
  report: "revenue" | "customers" | "visits";
  revenue: RevenueReportRow[];
  customers: CustomerReportRow[];
  visits: VisitReportRow[];
  stores: StoreListItem[];
  /** True when at least one store's visit rows were capped by the backend. */
  visitsTruncated?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [storeId, setStoreId] = useState("");

  const revenueRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return revenue.filter((r) => {
      if (storeId && r.storeId !== storeId) return false;
      return !q || r.storeName.toLowerCase().includes(q);
    });
  }, [revenue, storeId, search]);

  const customerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      if (storeId && !c.storeIds.includes(storeId)) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      return qDigits.length > 0 && c.phone.replace(/\D/g, "").includes(qDigits);
    });
  }, [customers, storeId, search]);

  const visitRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return visits.filter((v) => {
      if (storeId && v.storeId !== storeId) return false;
      if (!q) return true;
      if (v.name.toLowerCase().includes(q)) return true;
      return qDigits.length > 0 && v.phone.replace(/\D/g, "").includes(qDigits);
    });
  }, [visits, storeId, search]);

  const count = report === "revenue" ? revenueRows.length : report === "customers" ? customerRows.length : visitRows.length;
  const total = report === "revenue" ? revenue.length : report === "customers" ? customers.length : visits.length;

  function exportCsv() {
    if (report === "revenue") {
      downloadCsv(t.reports.csvRevenueFile, [
        [t.reports.csvStore, t.reports.csvRevenue, t.reports.csvVisits, t.reports.csvCurrency],
        ...revenueRows.map((r) => [
          r.storeName,
          moneyToDecimalString(r.revenue),
          String(r.visits),
          r.revenue.currency,
        ]),
      ]);
    } else if (report === "customers") {
      downloadCsv(t.reports.csvCustomerFile, [
        [t.reports.csvName, t.reports.csvPhone, t.reports.csvStores, t.reports.csvVisits, t.reports.csvSpend, t.reports.csvCurrency],
        ...customerRows.map((c) => [
          c.name,
          formatPhone(c.phone),
          c.storeLabel,
          String(c.visitsCount),
          c.totalSpend ? moneyToDecimalString(c.totalSpend) : "",
          c.totalSpend?.currency ?? "",
        ]),
      ]);
    } else {
      downloadCsv(t.reports.csvVisitFile, [
        [t.reports.csvName, t.reports.csvPhone, t.reports.csvStore, t.reports.csvVisitDatetime, t.reports.csvService, t.reports.csvAmount, t.reports.csvCurrency],
        ...visitRows.map((v) => [
          v.name,
          formatPhone(v.phone),
          v.storeName,
          v.completedAt,
          v.serviceName ?? "",
          moneyToDecimalString(v.amount),
          v.amount.currency,
        ]),
      ]);
    }
  }

  return (
    <div className="section">
      <div className="filter-row">
        <div className="search-box">
          <SearchIcon />
          <input
            type="search"
            placeholder={report === "revenue" ? t.reports.searchStore : t.reports.searchNamePhone}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">{t.reports.allStores}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || t.common.unnamed}
            </option>
          ))}
        </select>
        <span className="filter-count">
          {format(total === 1 ? t.reports.rowCountOne : t.reports.rowCount, {
            shown: formatCount(count),
            total: formatCount(total),
          })}
        </span>
        <button type="button" className="btn-primary" style={{ padding: "9px 16px", fontSize: 14 }} onClick={exportCsv} disabled={count === 0}>
          {t.common.exportCsv}
        </button>
      </div>

      {report === "visits" && visitsTruncated && (
        <div className="table-note" role="note" style={{ marginBottom: 8 }}>
          {t.reports.truncatedVisits}
        </div>
      )}

      <div className="table-wrap">
        {report === "revenue" ? (
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.reports.colStore}</th>
                <th className="num">{t.reports.colRevenue}</th>
                <th className="num">{t.reports.colVisits}</th>
              </tr>
            </thead>
            <tbody>
              {revenueRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-note">
                    {t.reports.emptyRevenue}
                  </td>
                </tr>
              )}
              {revenueRows.map((r) => (
                <tr key={r.storeId}>
                  <td className="nm">{r.storeName}</td>
                  <td className="num">{formatMoney(r.revenue)}</td>
                  <td className="num">{formatCount(r.visits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : report === "customers" ? (
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.reports.colName}</th>
                <th>{t.reports.colPhone}</th>
                <th>{t.reports.colStore}</th>
                <th className="num">{t.reports.colVisits}</th>
                <th className="num">{t.reports.colSpend}</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-note">
                    {t.reports.emptyCustomers}
                  </td>
                </tr>
              )}
              {customerRows.map((c) => (
                <tr key={c.key}>
                  <td className="nm">{c.name}</td>
                  <td>{formatPhone(c.phone)}</td>
                  <td>{c.storeLabel}</td>
                  <td className="num">{formatCount(c.visitsCount)}</td>
                  <td className="num">{c.totalSpend ? formatMoney(c.totalSpend) : t.common.dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.reports.colName}</th>
                <th>{t.reports.colPhone}</th>
                <th>{t.reports.colStore}</th>
                <th>{t.reports.colVisitDatetime}</th>
                <th>{t.reports.colService}</th>
                <th className="num">{t.reports.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {visitRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">
                    {t.reports.emptyVisits}
                  </td>
                </tr>
              )}
              {visitRows.map((v) => (
                <tr key={v.id}>
                  <td className="nm">{v.name}</td>
                  <td>{formatPhone(v.phone)}</td>
                  <td>{v.storeName}</td>
                  <td>{formatDateTime(v.completedAt)}</td>
                  <td>{v.serviceName || t.common.unknown}</td>
                  <td className="num">{formatMoney(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
