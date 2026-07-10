"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomerVisit, PlatformCustomer, StoreListItem } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import { formatCount, formatDate, formatMoney, formatMoneyCompact, isOlderThanDays } from "@/lib/format";

const SHOW_LIMIT = 50;
const TIMELINE_VISITS = 5;
const AT_RISK_DAYS = 60;

type Segment = "all" | "vip" | "risk";

type VisitWithStore = CustomerVisit & { storeName: string };

/** Absent from the map = still loading (the fetch starts as soon as a row is selected). */
type ProfileVisits = { status: "error" } | { status: "loaded"; visits: VisitWithStore[] };

/** Deterministic pastel index (0–4) so a customer keeps their avatar color. */
function avatarIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % 5;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

/**
 * Customers directory (wireframe 3a): gradient header with segment chips, a
 * customer list on the left, and a rich profile panel on the right. The profile
 * timeline fetches every membership's visits (a merged customer may span stores)
 * and interleaves them. Adaptations where the backend has no field: the "New"
 * segment and "since <date>" are omitted (no first-visit date), and the third
 * stat tile shows store count instead of no-shows.
 */
export default function CustomersDirectory({
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
  const [segment, setSegment] = useState<Segment>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileVisits>>({});
  const inflight = useRef<Set<string>>(new Set());

  const vipCount = useMemo(() => customers.filter((c) => c.isVip).length, [customers]);
  const riskCount = useMemo(
    () => customers.filter((c) => isOlderThanDays(c.lastVisitAt, AT_RISK_DAYS)).length,
    [customers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      if (segment === "vip" && !c.isVip) return false;
      if (segment === "risk" && !isOlderThanDays(c.lastVisitAt, AT_RISK_DAYS)) return false;
      if (storeId && !c.memberships.some((m) => m.storeId === storeId)) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      return qDigits.length > 0 && c.phone.replace(/\D/g, "").includes(qDigits);
    });
  }, [customers, search, storeId, segment]);

  const shown = filtered.slice(0, SHOW_LIMIT);
  // Derived selection: falls back to the first visible row whenever the current
  // pick is filtered out, so the profile panel is never stale or empty for no reason.
  const selected = shown.find((c) => c.key === selectedKey) ?? shown[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    const { key, memberships } = selected;
    if (profiles[key] || inflight.current.has(key)) return;
    inflight.current.add(key);
    // Deliberately NO cancellation cleanup: results land in a cache keyed by
    // customer, so a completion for a no-longer-selected row is still useful —
    // and cancelling on dependency changes (or StrictMode's dev double-mount)
    // would discard the only fetch the inflight guard allows, leaving the
    // profile stuck on "Loading" forever.
    (async () => {
      const results = await Promise.allSettled(
        memberships.map(async (m) => {
          const res = await fetch(`/api/stores/${m.storeId}/customers/${m.customerId}/visits`);
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as { data: CustomerVisit[] };
          return (json.data ?? []).map((v) => ({ ...v, storeName: m.storeName }));
        }),
      );
      inflight.current.delete(key);
      const ok = results.filter((r): r is PromiseFulfilledResult<VisitWithStore[]> => r.status === "fulfilled");
      // Error only when every membership failed — a multi-store customer keeps
      // a partial timeline if one store's request fails.
      if (ok.length === 0) {
        setProfiles((p) => ({ ...p, [key]: { status: "error" } }));
        return;
      }
      const visits = ok
        .flatMap((r) => r.value)
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
        .slice(0, TIMELINE_VISITS);
      setProfiles((p) => ({ ...p, [key]: { status: "loaded", visits } }));
    })();
  }, [selected, profiles]);

  function exportCsv() {
    downloadCsv("customers.csv", [
      ["Name", "Phone", "Stores", "Visits", "Spend", "Currency"],
      ...filtered.map((c) => [
        c.name,
        c.phone,
        c.memberships.map((m) => m.storeName).join(" / "),
        String(c.visitsCount),
        c.totalSpend ? String(c.totalSpend.amount / 100) : "",
        c.totalSpend?.currency ?? "",
      ]),
    ]);
  }

  const profile = selected ? profiles[selected.key] : undefined;

  return (
    <div className="cust-shell">
      <div className="cust-head">
        <div className="cust-head-row">
          <div>
            <h1>Customers</h1>
            <p>
              {formatCount(customers.length)} people across {stores.length} store{stores.length === 1 ? "" : "s"} ·
              unified by phone
            </p>
          </div>
          <div className="cust-head-actions">
            <button type="button" className="btn-primary" onClick={exportCsv} disabled={filtered.length === 0}>
              Export CSV
            </button>
            {/* Message customers button hidden until /broadcasts page is unparked.
            <button type="button" className="btn-primary" disabled title="Coming soon">
              Message customers
            </button>
            */}
          </div>
        </div>
        <div className="chip-row">
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
          <button
            type="button"
            className={`pill-choice ${segment === "all" ? "selected" : ""}`}
            onClick={() => setSegment("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`pill-choice ${segment === "vip" ? "selected" : ""}`}
            onClick={() => setSegment("vip")}
          >
            VIP · {vipCount}
          </button>
          <button
            type="button"
            className={`pill-choice ${segment === "risk" ? "selected" : ""}`}
            onClick={() => setSegment("risk")}
            title={`No visit in ${AT_RISK_DAYS} days`}
          >
            At risk · {riskCount}
          </button>
        </div>
      </div>

      <div className="cust-body">
        <div className="cust-list">
          <div className="table-wrap">
            <table className="store-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Store</th>
                  <th className="num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-note">
                      {customers.length === 0 ? "No customers yet" : "No customers match these filters"}
                    </td>
                  </tr>
                )}
                {shown.map((c) => {
                  const storeLabel =
                    c.memberships.length > 1
                      ? `${c.memberships[0].storeName} +${c.memberships.length - 1}`
                      : c.memberships[0].storeName;
                  return (
                    <tr
                      key={c.key}
                      className={`clickable ${selected?.key === c.key ? "sel" : ""}`}
                      onClick={() => setSelectedKey(c.key)}
                    >
                      <td>
                        <div className="cust-name-cell">
                          <span className={`avatar av-${avatarIndex(c.key)}`}>{initials(c.name)}</span>
                          <span className="who">
                            <span className="nm-line">
                              {c.name} {c.isVip && <span className="badge badge-vip">VIP</span>}
                            </span>
                            <span className="ph-line">{c.phone}</span>
                          </span>
                        </div>
                      </td>
                      <td>{storeLabel}</td>
                      <td className="num">{c.totalSpend ? formatMoneyCompact(c.totalSpend) : "—"}</td>
                    </tr>
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

        <div className="cust-profile">
          {!selected ? (
            <div className="profile-empty">Select a customer to see their profile</div>
          ) : (
            <>
              <div className="profile-band">Customer profile</div>
              <div className="profile-body">
                <div className="profile-avatar-row">
                  <span className={`avatar lg av-${avatarIndex(selected.key)}`}>{initials(selected.name)}</span>
                  <span className="who">
                    <div className="profile-name">
                      {selected.name} {selected.isVip && <span className="badge badge-vip">VIP</span>}
                    </div>
                    <div className="profile-sub">
                      {selected.phone} · last visit {selected.lastVisitLabel}
                    </div>
                  </span>
                </div>

                <div className="tile-row">
                  <div className="tile blue">
                    <span className="tile-label">Visits</span>
                    <span className="tile-value">{formatCount(selected.visitsCount)}</span>
                  </div>
                  <div className="tile teal">
                    <span className="tile-label">Spend</span>
                    <span className="tile-value">
                      {selected.totalSpend ? formatMoneyCompact(selected.totalSpend) : "—"}
                    </span>
                  </div>
                  <div className="tile amber">
                    <span className="tile-label">Stores</span>
                    <span className="tile-value">{selected.memberships.length}</span>
                  </div>
                </div>

                <div className="profile-label">Recent visits</div>
                {!profile && <div className="profile-sub">Loading visit history…</div>}
                {profile?.status === "error" && <div className="profile-sub">Could not load visit history.</div>}
                {profile?.status === "loaded" &&
                  (profile.visits.length === 0 ? (
                    <div className="profile-sub">
                      {selected.visitsCount > 0
                        ? "No detailed visit records — this customer's visit count predates visit tracking."
                        : "No recorded visits yet."}
                    </div>
                  ) : (
                    <div className="timeline">
                      {profile.visits.map((v) => (
                        <div key={v.id} className="timeline-item">
                          <span className="timeline-dot" />
                          <div className="timeline-main">
                            <span>
                              {v.serviceName || "(unknown)"}
                              {v.staffName ? ` · ${v.staffName}` : ""}
                            </span>
                            <b>{formatMoney(v.amount)}</b>
                          </div>
                          <div className="timeline-sub">
                            {formatDate(v.completedAt)} · {v.storeName}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}

                {selected.notes && (
                  <div className="note-chip">
                    <b>Note</b> · {selected.notes}
                  </div>
                )}

                <div className="profile-actions">
                  {/* Message action removed per request.
                  <a className="btn-primary" href={`sms:+${selected.phone.replace(/\D/g, "")}`}>
                    Message
                  </a>
                  */}
                  <button type="button" className="btn-primary" disabled title="Coming soon">
                    Mark VIP
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
