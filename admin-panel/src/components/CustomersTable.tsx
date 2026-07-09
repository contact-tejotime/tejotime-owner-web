"use client";

import { Fragment, useMemo, useState } from "react";
import type { AdminCustomer, CustomerVisit } from "@/lib/types";
import { formatCount, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";

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
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />
          VIP only
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="recent">Newest first</option>
          <option value="spend">Highest spend</option>
          <option value="visits">Most visits</option>
        </select>
        <span className="filter-count">
          {filtered.length} of {customers.length} customer{customers.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="table-wrap">
        <table className="store-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th className="num">Visits</th>
              <th className="num">Total spend</th>
              <th>Last visit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-note">
                  {customers.length === 0 ? "No customers yet" : "No customers match these filters"}
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const drawer = drawers[c.id];
              return (
                <Fragment key={c.id}>
                  <tr className="clickable" onClick={() => toggleDrawer(c.id)}>
                    <td className="nm">
                      {c.name} {c.isVip && <span className="badge badge-vip">VIP</span>}
                    </td>
                    <td>{c.phone}</td>
                    <td className="num">{formatCount(c.visitsCount)}</td>
                    <td className="num">{formatMoneyCompact(c.totalSpend)}</td>
                    <td>{c.lastVisitLabel}</td>
                  </tr>
                  {openId === c.id && (
                    <tr className="drawer-row">
                      <td colSpan={5}>
                        <div className="drawer-inner">
                          {(!drawer || drawer.status === "loading") && "Loading visit history…"}
                          {drawer?.status === "error" && "Could not load visit history."}
                          {drawer?.status === "loaded" &&
                            (drawer.visits.length === 0 ? (
                              "No recorded visits yet."
                            ) : (
                              <table className="store-table">
                                <thead>
                                  <tr>
                                    <th>When</th>
                                    <th>Service</th>
                                    <th>Staff</th>
                                    <th className="num">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {drawer.visits.map((v) => (
                                    <tr key={v.id}>
                                      <td>{formatDateTime(v.completedAt)}</td>
                                      <td>{v.serviceName || "(unknown)"}</td>
                                      <td>{v.staffName || "—"}</td>
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
