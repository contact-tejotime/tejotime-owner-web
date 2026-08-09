"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Spinner } from "@/components/Skeleton";

/**
 * Business name and address.
 *
 * Scoped to exactly the two fields the mobile app's profile screen edits (`PATCH /business`
 * with `{ name?, address? }`). The backend accepts more, but the richer profile — tagline,
 * description, images, theme — is the admin panel's job, and having two apps writing the same
 * columns from different forms is how they drift.
 */
export function BusinessProfileForm({ name, address }: { name: string; address: string }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [n, setN] = useState(name);
  const [a, setA] = useState(address);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  const dirty = n !== name || a !== address;

  async function save() {
    setError("");
    setInFlight(true);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n.trim(), address: a.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Could not save.");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div className="section">
      <h2>Business</h2>
      <div className="field">
        <label htmlFor="bp-name">Name</label>
        <input id="bp-name" value={n} onChange={(e) => { setN(e.target.value); setSaved(false); }} />
      </div>
      <div className="field">
        <label htmlFor="bp-addr">Address</label>
        <input id="bp-addr" value={a} onChange={(e) => { setA(e.target.value); setSaved(false); }} />
      </div>

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}
      {saved ? <p className="hint">Saved.</p> : null}

      <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>
        {busy ? (
          <>
            <Spinner size={14} />
            Saving…
          </>
        ) : (
          "Save changes"
        )}
      </button>
    </div>
  );
}
