"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StoreListItemWithMetrics } from "@/lib/types";
import { formatCount, formatMoneyCompact } from "@/lib/format";
import { t } from "@/i18n";
import { ExternalLinkIcon } from "@/components/icons";
import Spinner from "./ui/Spinner";
import { frontendUrl } from "@/lib/frontend-url";

const FRONTEND_URL = frontendUrl();

/**
 * The homepage demo stores (docs/demo-stores.md), under the main stores table. Same columns, but no
 * selection, bulk actions or Enabled toggle: these stores can't be disabled (the backend refuses
 * with 409 DEMO_STORE_ALWAYS_ON), so the column states it instead of offering a switch.
 */
export default function DemoStoresTable({ stores }: { stores: StoreListItemWithMetrics[] }) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [navId, setNavId] = useState<string | null>(null);

  function openStore(id: string) {
    setNavId(id);
    startNav(() => router.push(`/stores/${id}`));
  }

  return (
    <div className="section">
      <div className="table-wrap">
        <table className="store-table">
          <thead>
            <tr>
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
            {stores.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => openStore(s.id)}>
                <td className="nm">
                  <Link href={`/stores/${s.id}`} onClick={(e) => e.stopPropagation()}>
                    {s.name || t.common.unnamed}
                  </Link>
                  {navPending && navId === s.id && (
                    <Spinner size={12} style={{ marginLeft: 8, color: "var(--primary)" }} />
                  )}
                </td>
                {/* The homepage card ("Nail studios") in place of the shared "Salon & Barber". */}
                <td>{[s.demoIndustry ?? s.category, s.city].filter(Boolean).join(" · ") || t.common.dash}</td>
                <td className="num">{formatCount(s.customersCount)}</td>
                <td className="num">{formatCount(s.visits30d)}</td>
                <td className="num">{formatMoneyCompact(s.revenue30d)}</td>
                <td>
                  <span className="badge badge-active">{t.stores.alwaysOn}</span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {FRONTEND_URL && s.phoneFull ? (
                    <a
                      href={`${FRONTEND_URL}/${s.phoneFull}`}
                      target="_blank"
                      rel="noreferrer"
                      title={t.stores.openMicrosite}
                      className="visit-link"
                    >
                      <ExternalLinkIcon />
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
