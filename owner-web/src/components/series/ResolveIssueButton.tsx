"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { t } from "@/i18n";

import { Spinner } from "@/components/Skeleton";
import { showToast } from "@/lib/toast";

/**
 * "Mark handled" on a Needs attention item: the owner has phoned the customer and booked another
 * time or skipped the date. The API needs `appointments: manage`; the caller hides this without it.
 *
 * The page refresh runs in a transition so the button stays busy until the item has actually gone,
 * rather than going idle while the server is still re-rendering (see lib/use-mutation.ts).
 */
export function ResolveIssueButton({
  issueId,
  onResolved,
}: {
  issueId: string;
  /** The series sheet drops the item from its own copy straight away. */
  onResolved?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  async function resolve() {
    setInFlight(true);
    try {
      const res = await fetch(`/api/appointments/series/issues/${encodeURIComponent(issueId)}/resolve`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json?.error?.message ?? t.common.thatDidntWork, "error");
        return;
      }
      showToast(t.series.markedHandled, "success");
      onResolved?.();
      startTransition(() => router.refresh());
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <button type="button" className="srs-ghost-btn" disabled={busy} aria-busy={busy || undefined} onClick={resolve}>
      {busy ? <Spinner size={13} /> : null}
      {t.series.markHandled}
    </button>
  );
}
