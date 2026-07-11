"use client";

import { useMemo, useState } from "react";
import type { Money, StoreListItem } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import { formatCount, formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

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
}: {
  report: "revenue" | "customers" | "visits";
  revenue: RevenueReportRow[];
  customers: CustomerReportRow[];
  visits: VisitReportRow[];
  stores: StoreListItem[];
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
      downloadCsv("revenue-report.csv", [
        ["Store", "Revenue", "Visits", "Currency"],
        ...revenueRows.map((r) => [
          r.storeName,
          String(r.revenue.amount / 100),
          String(r.visits),
          r.revenue.currency,
        ]),
      ]);
    } else if (report === "customers") {
      downloadCsv("customer-report.csv", [
        ["Name", "Phone", "Stores", "Visits", "Spend", "Currency"],
        ...customerRows.map((c) => [
          c.name,
          formatPhone(c.phone),
          c.storeLabel,
          String(c.visitsCount),
          c.totalSpend ? String(c.totalSpend.amount / 100) : "",
          c.totalSpend?.currency ?? "",
        ]),
      ]);
    } else {
      downloadCsv("customer-visit-report.csv", [
        ["Name", "Phone", "Store", "Visit Datetime", "Service", "Amount", "Currency"],
        ...visitRows.map((v) => [
          v.name,
          formatPhone(v.phone),
          v.storeName,
          v.completedAt,
          v.serviceName ?? "",
          String(v.amount.amount / 100),
          v.amount.currency,
        ]),
      ]);
    }
  }

  return (
    <div className="section">
      <div className="filter-row">
        <div className="search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder={report === "revenue" ? "Search store…" : "Search name or phone…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || "(unnamed)"}
            </option>
          ))}
        </select>
        <span className="filter-count">
          {formatCount(count)} of {formatCount(total)} row{total === 1 ? "" : "s"}
        </span>
        <button type="button" className="btn-primary" style={{ padding: "9px 16px", fontSize: 14 }} onClick={exportCsv} disabled={count === 0}>
          Export CSV
        </button>
      </div>

      <div className="table-wrap">
        {report === "revenue" ? (
          <table className="store-table">
            <thead>
              <tr>
                <th>Store</th>
                <th className="num">Revenue</th>
                <th className="num">Visits</th>
              </tr>
            </thead>
            <tbody>
              {revenueRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-note">
                    No stores match these filters
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
                <th>Name</th>
                <th>Phone</th>
                <th>Store</th>
                <th className="num">Visits</th>
                <th className="num">Spend</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-note">
                    No customers match these filters
                  </td>
                </tr>
              )}
              {customerRows.map((c) => (
                <tr key={c.key}>
                  <td className="nm">{c.name}</td>
                  <td>{formatPhone(c.phone)}</td>
                  <td>{c.storeLabel}</td>
                  <td className="num">{formatCount(c.visitsCount)}</td>
                  <td className="num">{c.totalSpend ? formatMoney(c.totalSpend) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="store-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Store</th>
                <th>Visit datetime</th>
                <th>Service</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visitRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">
                    No visits match these filters
                  </td>
                </tr>
              )}
              {visitRows.map((v) => (
                <tr key={v.id}>
                  <td className="nm">{v.name}</td>
                  <td>{formatPhone(v.phone)}</td>
                  <td>{v.storeName}</td>
                  <td>{formatDateTime(v.completedAt)}</td>
                  <td>{v.serviceName || "(unknown)"}</td>
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
