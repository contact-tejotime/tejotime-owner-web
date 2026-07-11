"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StoreListItemWithMetrics } from "@/lib/types";
import { formatCount, formatMoneyCompact } from "@/lib/format";
import ConfirmDialog from "./ConfirmDialog";
import ExternalLinkIcon from "./ExternalLinkIcon";
import StoreStatusToggle from "./StoreStatusToggle";
import Spinner from "./ui/Spinner";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com";

/** Distinct non-empty values of one field, alphabetical — options for a filter select. */
function distinct(stores: StoreListItemWithMetrics[], pick: (s: StoreListItemWithMetrics) => string | null) {
  return [...new Set(stores.map(pick).filter((v): v is string => Boolean(v)))].sort();
}

export default function StoresTable({ stores }: { stores: StoreListItemWithMetrics[] }) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [navId, setNavId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const cities = useMemo(() => distinct(stores, (s) => s.city), [stores]);
  const categories = useMemo(() => distinct(stores, (s) => s.category), [stores]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !s.phoneFull.includes(q)) return false;
      if (city && s.city !== city) return false;
      if (category && s.category !== category) return false;
      if (status && String(s.isActive) !== status) return false;
      return true;
    });
  }, [stores, search, city, category, status]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  function openStore(id: string) {
    setNavId(id);
    startNav(() => router.push(`/stores/${id}`));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((s) => s.id)));
  }

  async function bulkSetActive(isActive: boolean) {
    setBulkBusy(true);
    setBulkError(null);
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/stores/${id}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json.error?.message || `Update failed (${res.status})`);
        }
      }),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      setBulkError(`${failures.length} of ${ids.length} failed: ${failures[0].reason?.message ?? "unknown error"}`);
    } else {
      setSelected(new Set());
    }
    setBulkBusy(false);
    setBulkConfirm(false);
    router.refresh();
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
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <span className="filter-count">
          {filtered.length} of {stores.length} store{stores.length === 1 ? "" : "s"}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="count">
            {selected.size} selected{bulkError ? ` · ${bulkError}` : ""}
          </span>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetActive(true)} aria-busy={bulkBusy || undefined}>
            {bulkBusy && <Spinner className="btn-spinner" />}
            Enable
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => setBulkConfirm(true)}>
            Disable
          </button>
          <button type="button" className="clear" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            ✕ Clear
          </button>
        </div>
      )}

      {bulkConfirm && (
        <ConfirmDialog
          title={`Disable ${selected.size} store${selected.size === 1 ? "" : "s"}?`}
          body="Their microsites go offline and online bookings stop. Existing data is kept."
          confirmLabel="Disable stores"
          danger
          busy={bulkBusy}
          onConfirm={() => bulkSetActive(false)}
          onCancel={() => setBulkConfirm(false)}
        />
      )}

      <div className="table-wrap">
        <table className="store-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all stores"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  style={{ width: "auto" }}
                />
              </th>
              <th>Name</th>
              <th>Category · City</th>
              <th className="num">Customers</th>
              <th className="num">Visits (30d)</th>
              <th className="num">Revenue (30d)</th>
              <th>Enabled</th>
              <th>Visit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-note">
                  No stores match these filters
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => openStore(s.id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${s.name || "(unnamed)"}`}
                    checked={selected.has(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    style={{ width: "auto" }}
                  />
                </td>
                <td className="nm">
                  <Link href={`/stores/${s.id}`} onClick={(e) => e.stopPropagation()}>
                    {s.name || "(unnamed)"}
                  </Link>
                  {navPending && navId === s.id && (
                    <Spinner size={12} style={{ marginLeft: 8, color: "var(--primary)" }} />
                  )}
                </td>
                <td>{[s.category, s.city].filter(Boolean).join(" · ") || "—"}</td>
                <td className="num">{formatCount(s.customersCount)}</td>
                <td className="num">{formatCount(s.visits30d)}</td>
                <td className="num">{formatMoneyCompact(s.revenue30d)}</td>
                <td>
                  {/* Keyed on isActive so bulk updates (which bypass this row's local state) remount it in sync. */}
                  <StoreStatusToggle
                    key={`${s.id}:${s.isActive}`}
                    storeId={s.id}
                    storeName={s.name || "(unnamed)"}
                    isActive={s.isActive}
                    size="sm"
                  />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <a
                    href={`${FRONTEND_URL}/${s.phoneFull}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open microsite"
                    className="visit-link"
                  >
                    <ExternalLinkIcon />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
