"use client";

import { Fragment, useMemo, useState } from "react";
import type { CustomerVisit, PlatformCustomer, StoreListItem } from "@/lib/types";
import { formatCount, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";

const SHOW_LIMIT = 50;
const DRAWER_VISITS = 5;

type DrawerState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; visits: CustomerVisit[] };

/**
 * Platform-wide customers table (wireframe 5a): one search box, a store filter,
 * and rows that expand inline. A merged customer may span several stores, so the
 * expanded visit history fetches every membership's visits and interleaves them.
 * ("Since" and "No-shows" from the wireframe are omitted — the backend has no
 * first-visit or per-customer no-show fields yet.)
 */
export default function PlatformCustomersTable({
  customers,
  stores,
  initialQuery,
}: {
  customers: PlatformCustomer[];
  stores: StoreListItem[];
  initialQuery: string;
}) {
  const [search, setSearch] = useState(initialQuery);
  const [storeId, setStoreId] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drawers, setDrawers] = useState<Record<string, DrawerState>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      if (storeId && !c.memberships.some((m) => m.storeId === storeId)) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      return qDigits.length > 0 && c.phone.replace(/\D/g, "").includes(qDigits);
    });
  }, [customers, search, storeId]);

  const shown = filtered.slice(0, SHOW_LIMIT);

  async function toggleDrawer(customer: PlatformCustomer) {
    if (openKey === customer.key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(customer.key);
    if (drawers[customer.key]?.status === "loaded") return; // already fetched

    setDrawers((d) => ({ ...d, [customer.key]: { status: "loading" } }));
    try {
      const responses = await Promise.all(
        customer.memberships.map(async (m) => {
          const res = await fetch(`/api/stores/${m.storeId}/customers/${m.customerId}/visits`);
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as { data: CustomerVisit[] };
          return json.data ?? [];
        }),
      );
      const visits = responses
        .flat()
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
        .slice(0, DRAWER_VISITS);
      setDrawers((d) => ({ ...d, [customer.key]: { status: "loaded", visits } }));
    } catch {
      setDrawers((d) => ({ ...d, [customer.key]: { status: "error" } }));
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
            placeholder="Search name or phone…"
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
          {filtered.length} of {customers.length} customer{customers.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="table-wrap">
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
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-note">
                  {customers.length === 0 ? "No customers yet" : "No customers match these filters"}
                </td>
              </tr>
            )}
            {shown.map((c) => {
              const drawer = drawers[c.key];
              const storeLabel =
                c.memberships.length > 1
                  ? `${c.memberships[0].storeName} +${c.memberships.length - 1}`
                  : c.memberships[0].storeName;
              return (
                <Fragment key={c.key}>
                  <tr className="clickable" onClick={() => toggleDrawer(c)}>
                    <td className="nm">
                      {c.name} {c.isVip && <span className="badge badge-vip">VIP</span>}
                    </td>
                    <td>{c.phone}</td>
                    <td>{storeLabel}</td>
                    <td className="num">{formatCount(c.visitsCount)}</td>
                    <td className="num">{c.totalSpend ? formatMoneyCompact(c.totalSpend) : "—"}</td>
                  </tr>
                  {openKey === c.key && (
                    <tr className="drawer-row">
                      <td colSpan={5}>
                        <div className="drawer-inner">
                          <div className="detail-strip">
                            <span>
                              Last visit <b>{c.lastVisitLabel}</b>
                            </span>
                            <span>
                              <b>{formatCount(c.visitsCount)}</b> visit{c.visitsCount === 1 ? "" : "s"}
                            </span>
                            {c.notes && (
                              <span>
                                Note · <b>{c.notes}</b>
                              </span>
                            )}
                            <span className="spacer">
                              <a href={`sms:+${c.phone.replace(/\D/g, "")}`}>Message</a>
                            </span>
                          </div>
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
      {filtered.length > SHOW_LIMIT && (
        <div className="table-note">
          Showing {SHOW_LIMIT} of {formatCount(filtered.length)} · same phone across stores counts as one customer
        </div>
      )}
    </div>
  );
}
