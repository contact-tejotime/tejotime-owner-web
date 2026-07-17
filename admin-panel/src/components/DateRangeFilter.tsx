"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import { t } from "@/i18n";

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
  const searchParams = useSearchParams();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [draftStatus, setDraftStatus] = useState(status ?? "");
  const [isPending, startTransition] = useTransition();

  function apply() {
    // Merge into the current querystring so unrelated params (e.g. ?report=)
    // survive a date change; only own keys are touched.
    const params = new URLSearchParams(searchParams.toString());
    if (draftFrom) params.set("from", draftFrom);
    else params.delete("from");
    if (draftTo) params.set("to", draftTo);
    else params.delete("to");
    if (statusOptions) {
      if (draftStatus) params.set("status", draftStatus);
      else params.delete("status");
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div className="filter-row">
      <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {t.dateRange.from}{" "}
        <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(e) => setDraftFrom(e.target.value)} />
      </label>
      <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {t.dateRange.to}{" "}
        <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)} />
      </label>
      {statusOptions && (
        <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
          <option value="">{t.dateRange.allStatuses}</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <Button type="button" className="btn-add" onClick={apply} loading={isPending}>
        {t.common.apply}
      </Button>
    </div>
  );
}
