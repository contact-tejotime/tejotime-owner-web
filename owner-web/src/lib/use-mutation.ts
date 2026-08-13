"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { useCallback, useState, useTransition } from "react";

/**
 * One place for "call the API, then show the new data", with honest busy state.
 *
 * The bug this exists to kill: every editor in this app used to do
 *
 *     setBusy(true); await fetch(...); router.refresh(); finally setBusy(false)
 *
 * `router.refresh()` is asynchronous and was not awaited, so `busy` flipped back to false the
 * instant the fetch resolved — while the server was still re-rendering the page. The spinner
 * stopped, the screen still showed the old values, and the honest-looking conclusion was that
 * the save had failed. People pressed Save twice.
 *
 * Wrapping the refresh in a transition makes `isPending` stay true until the server data has
 * actually landed, so `busy` below covers the whole round trip: request AND re-render.
 */
export function useMutation() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(
    async (
      url: string,
      init: { method: string; body?: unknown },
      opts: { fallback?: string; refresh?: boolean } = {},
    ): Promise<{ ok: boolean; data: unknown }> => {
      setInFlight(true);
      setError("");
      try {
        const res = await fetch(url, {
          method: init.method,
          headers: { "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message =
            (data as { error?: { message?: string } })?.error?.message ??
            opts.fallback ??
            t.mutation.generic;
          setError(message);
          return { ok: false, data };
        }
        if (opts.refresh !== false) startTransition(() => router.refresh());
        return { ok: true, data };
      } catch {
        setError(t.mutation.networkError);
        return { ok: false, data: null };
      } finally {
        setInFlight(false);
      }
    },
    [router],
  );

  return {
    run,
    /** True for the whole round trip — the request AND the server re-render that follows. */
    busy: inFlight || isPending,
    error,
    setError,
  };
}
