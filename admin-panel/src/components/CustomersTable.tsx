"use client";

import { Fragment, useMemo, useState } from "react";
import type { AdminCustomer, CustomerVisit } from "@/lib/types";
import { formatCount, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { t, format } from "@/i18n";
import TableSkeleton from "./ui/skeletons/TableSkeleton";

type SortKey = "recent" | "spend" | "visits";

type DrawerState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; visits: CustomerVisit[] };

export default function CustomersTable({ storeId, customers }: { storeId: string; customers: AdminCustomer[] }) {
  const [search, setSearch] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawers, setDrawers] = useState<Record<string, DrawerState>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter((c) => {
      if (vipOnly && !c.isVip) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
      return true;
    });
    if (sort === "spend") return [...rows].sort((a, b) => b.totalSpend.amount - a.totalSpend.amount);
    if (sort === "visits") return [...rows].sort((a, b) => b.visitsCount - a.visitsCount);
    return rows; // backend order: most recently created first
  }, [customers, search, vipOnly, sort]);

  async function toggleDrawer(customerId: string) {
    if (openId === customerId) {
      setOpenId(null);
      return;
    }
    setOpenId(customerId);
    if (drawers[customerId]?.status === "loaded") return; // already fetched

    setDrawers((d) => ({ ...d, [customerId]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/stores/${storeId}/customers/${customerId}/visits`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data: CustomerVisit[] };
      setDrawers((d) => ({ ...d, [customerId]: { status: "loaded", visits: json.data ?? [] } }));
    } catch {
      setDrawers((d) => ({ ...d, [customerId]: { status: "error" } }));
    }
  }

  return (
    <div className="section">
      <div className="filter-row">
        <input
          type="search"
          placeholder={t.customersTable.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />
          {t.customersTable.vipOnly}
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="recent">{t.customersTable.sortRecent}</option>
          <option value="spend">{t.customersTable.sortSpend}</option>
          <option value="visits">{t.customersTable.sortVisits}</option>
        </select>
        <span className="filter-count">
          {format(customers.length === 1 ? t.customersTable.filterCountOne : t.customersTable.filterCount, {
            shown: filtered.length,
            total: customers.length,
          })}
        </span>
      </div>

      <div className="table-wrap">
        <table className="store-table">
          <thead>
            <tr>
              <th>{t.customersTable.colName}</th>
              <th>{t.customersTable.colPhone}</th>
              <th className="num">{t.customersTable.colVisits}</th>
              <th className="num">{t.customersTable.colSpend}</th>
              <th>{t.customersTable.colLastVisit}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-note">
                  {customers.length === 0 ? t.customersTable.emptyNoCustomers : t.customersTable.emptyNoMatch}
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const drawer = drawers[c.id];
              return (
                <Fragment key={c.id}>
                  <tr
                    className="clickable"
                    onClick={() => toggleDrawer(c.id)}
                    tabIndex={0}
                    role="button"
                    aria-expanded={openId === c.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleDrawer(c.id);
                      }
                    }}
                  >
                    <td className="nm">
                      {c.name} {c.isVip && <span className="badge badge-vip">{t.common.vip}</span>}
                    </td>
                    <td>{formatPhone(c.phone)}</td>
                    <td className="num">{formatCount(c.visitsCount)}</td>
                    <td className="num">{formatMoneyCompact(c.totalSpend)}</td>
                    <td>{c.lastVisitLabel}</td>
                  </tr>
                  {openId === c.id && (
                    <tr className="drawer-row">
                      <td colSpan={5}>
                        <div className="drawer-inner">
                          {(!drawer || drawer.status === "loading") && (
                            <TableSkeleton rows={3} cols={4} numCols={1} />
                          )}
                          {drawer?.status === "error" && t.customersTable.historyError}
                          {drawer?.status === "loaded" &&
                            (drawer.visits.length === 0 ? (
                              t.customersTable.noVisitsYet
                            ) : (
                              <table className="store-table">
                                <thead>
                                  <tr>
                                    <th>{t.customersTable.drawerWhen}</th>
                                    <th>{t.customersTable.drawerService}</th>
                                    <th>{t.customersTable.drawerStaff}</th>
                                    <th className="num">{t.customersTable.drawerAmount}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {drawer.visits.map((v) => (
                                    <tr key={v.id}>
                                      <td>{formatDateTime(v.completedAt)}</td>
                                      <td>{v.serviceName || t.common.unknown}</td>
                                      <td>{v.staffName || t.common.dash}</td>
                                      <td className="num">{formatMoney(v.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
