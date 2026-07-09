"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Enable/disable switch for one store. Disabling asks for confirmation (it takes
 * the microsite offline); enabling applies immediately. The flag is flipped
 * optimistically and reverted with the backend's message if the PATCH fails —
 * the backend requires a full valid store body, so legacy stores with missing
 * required fields fail here until fixed in Settings.
 */
export default function StoreStatusToggle({
  storeId,
  storeName,
  isActive,
  size,
}: {
  storeId: string;
  storeName: string;
  isActive: boolean;
  size?: "sm";
}) {
  const router = useRouter();
  const [on, setOn] = useState(isActive);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: boolean) {
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      const res = await fetch(`/api/stores/${storeId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(json.error?.message || `Update failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setOn(!next);
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className={`switch ${size === "sm" ? "sm" : ""} ${on ? "on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Disable" : "Enable"} ${storeName}`}
        disabled={busy}
        onClick={() => (on ? setConfirming(true) : apply(true))}
      >
        <span className="knob" />
      </button>
      {error && (
        <span className="toggle-error" title={error}>
          Failed — fix in Settings
        </span>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Disable ${storeName}?`}
          body="The microsite goes offline and online bookings stop. Existing data is kept."
          confirmLabel="Disable store"
          danger
          busy={busy}
          onConfirm={() => apply(false)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </span>
  );
}
