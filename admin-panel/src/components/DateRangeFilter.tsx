"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export interface StatusOption {
  value: string;
  label: string;
}

/**
 * from/to date inputs (+ optional status select) that write their values to the
 * querystring — the server component re-fetches with the new filters.
 */
export default function DateRangeFilter({
  from,
  to,
  status,
  statusOptions,
}: {
  from: string;
  to: string;
  status?: string;
  statusOptions?: StatusOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [draftStatus, setDraftStatus] = useState(status ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (draftFrom) params.set("from", draftFrom);
    if (draftTo) params.set("to", draftTo);
    if (draftStatus) params.set("status", draftStatus);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="filter-row">
      <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
        From{" "}
        <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(e) => setDraftFrom(e.target.value)} />
      </label>
      <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
        To{" "}
        <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)} />
      </label>
      {statusOptions && (
        <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn-add" onClick={apply}>
        Apply
      </button>
    </div>
  );
}
