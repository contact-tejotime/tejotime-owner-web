"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StoreListItemWithMetrics } from "@/lib/types";
import { formatCount, formatMoneyCompact } from "@/lib/format";
import { t, format } from "@/i18n";
import { ExternalLinkIcon, Icon } from "@/components/icons";
import ConfirmDialog from "./ConfirmDialog";
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
  const someFilteredSelected = filtered.some((s) => selected.has(s.id)) && !allFilteredSelected;

  // Native checkboxes can't express "indeterminate" via props — set it imperatively.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

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
      setBulkError(
        format(t.stores.bulkFailed, {
          failed: failures.length,
          total: ids.length,
          reason: failures[0].reason?.message ?? "unknown error",
        }),
      );
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
          placeholder={t.stores.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">{t.stores.allCities}</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t.stores.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t.stores.anyStatus}</option>
          <option value="true">{t.stores.active}</option>
          <option value="false">{t.stores.inactive}</option>
        </select>
        <span className="filter-count">
          {format(stores.length === 1 ? t.stores.filterCountOne : t.stores.filterCount, {
            shown: filtered.length,
            total: stores.length,
          })}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="count">
            {format(t.stores.selectedCount, { count: selected.size })}
            {bulkError ? ` · ${bulkError}` : ""}
          </span>
          <button type="button" disabled={bulkBusy} onClick={() => bulkSetActive(true)} aria-busy={bulkBusy || undefined}>
            {bulkBusy && <Spinner className="btn-spinner" />}
            {t.stores.enable}
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => setBulkConfirm(true)}>
            {t.stores.disable}
          </button>
          <button type="button" className="clear" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            <Icon name="x" size={13} /> {t.stores.clear}
          </button>
        </div>
      )}

      {bulkConfirm && (
        <ConfirmDialog
          title={format(selected.size === 1 ? t.stores.bulkDisableTitleOne : t.stores.bulkDisableTitle, {
            count: selected.size,
          })}
          body={t.stores.bulkDisableBody}
          confirmLabel={t.stores.bulkDisableConfirm}
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
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label={t.stores.selectAll}
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  style={{ width: "auto" }}
                />
              </th>
              <th>{t.stores.colName}</th>
              <th>{t.stores.colCategoryCity}</th>
              <th className="num">{t.stores.colCustomers}</th>
              <th className="num">{t.stores.colVisits30d}</th>
              <th className="num">{t.stores.colRevenue30d}</th>
              <th>{t.stores.colEnabled}</th>
              <th>{t.stores.colVisit}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-note">
                  {stores.length === 0 ? t.stores.emptyNoStores : t.stores.emptyNoMatch}
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => openStore(s.id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={format(t.stores.selectOne, { name: s.name || t.common.unnamed })}
                    checked={selected.has(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    style={{ width: "auto" }}
                  />
                </td>
                <td className="nm">
                  <Link href={`/stores/${s.id}`} onClick={(e) => e.stopPropagation()}>
                    {s.name || t.common.unnamed}
                  </Link>
                  {navPending && navId === s.id && (
                    <Spinner size={12} style={{ marginLeft: 8, color: "var(--primary)" }} />
                  )}
                </td>
                <td>{[s.category, s.city].filter(Boolean).join(" · ") || t.common.dash}</td>
                <td className="num">{formatCount(s.customersCount)}</td>
                <td className="num">{formatCount(s.visits30d)}</td>
                <td className="num">{formatMoneyCompact(s.revenue30d)}</td>
                <td>
                  {/* Keyed on isActive so bulk updates (which bypass this row's local state) remount it in sync. */}
                  <StoreStatusToggle
                    key={`${s.id}:${s.isActive}`}
                    storeId={s.id}
                    storeName={s.name || t.common.unnamed}
                    isActive={s.isActive}
                    size="sm"
                  />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <a
                    href={`${FRONTEND_URL}/${s.phoneFull}`}
                    target="_blank"
                    rel="noreferrer"
                    title={t.stores.openMicrosite}
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
