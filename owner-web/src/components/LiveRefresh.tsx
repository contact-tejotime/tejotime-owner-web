"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "";
const DEBOUNCE_MS = 300;
const REDIAL_MIN_MS = 2_000;
const REDIAL_MAX_MS = 30_000;

/**
 * Keeps a Server Component page live: when the backend announces a change, re-render the
 * route with `router.refresh()`.
 *
 * Pages here are rendered once on the server, so a customer checking in from the microsite used
 * to appear only after a manual reload — the mobile app heard the `/owner` socket, the web never
 * listened. Refreshing (rather than splicing the socket payload into state) keeps one source of
 * truth: the same server read that produced the page, headers and counts included.
 *
 * The socket authenticates with a 60s ticket from `/api/realtime/ticket`, because the access
 * token is an httpOnly cookie. `auth` is a function so Socket.IO asks for a fresh ticket on every
 * reconnect — a ticket from the first connect would long be expired.
 *
 * Falls back to polling when live updates cannot arrive: no socket URL configured, the socket
 * cannot connect (CORS, API down), or a staff login — staff sockets join a seat room the
 * backend does not emit to yet.
 */
export function LiveRefresh({
  events,
  pollOnly = false,
  pollMs = 15_000,
}: {
  /** Owner-namespace events that mean this page's data changed. */
  events: string[];
  /** Skip the socket and just poll (staff logins). */
  pollOnly?: boolean;
  pollMs?: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Joined into a string so a new array literal on each parent render doesn't reconnect.
  const eventKey = events.join(",");
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let socket: Socket | null = null;

    const refresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        startTransition(() => routerRef.current.refresh());
      }, DEBOUNCE_MS);
    };

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, pollMs);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    /*
     * Keeping the socket alive for a whole working day, idle or not.
     *
     * An idle connection is not the risk: Socket.IO's server pings every 25s, which keeps
     * proxies from reaping it and detects a dead peer within ~45s. The ticket's 60s expiry does
     * not matter either — it is checked once, at the handshake, never on a live connection.
     *
     * The risk is the two cases where Socket.IO gives up for good (`socket.active === false`)
     * instead of retrying: the server refused the handshake (the ticket fetch failed during a
     * cookie rotation or an API blip), or the server kicked us ("io server disconnect"). Left
     * alone, the tab would sit on 15s polling for the rest of the day. So those two cases
     * re-dial by hand, with backoff; ordinary drops (sleep, Wi-Fi, deploys) Socket.IO retries
     * by itself.
     */
    let redial: ReturnType<typeof setTimeout> | null = null;
    let redialDelay = REDIAL_MIN_MS;
    let closed = false;
    const scheduleRedial = () => {
      if (closed || !socket || socket.active || redial) return;
      redial = setTimeout(() => {
        redial = null;
        if (!closed && socket && !socket.connected) socket.connect();
      }, redialDelay);
      redialDelay = Math.min(redialDelay * 2, REDIAL_MAX_MS);
    };
    // Don't wait out a long backoff once the user is back or the network returns.
    const redialNow = () => {
      if (closed || !socket || socket.connected || socket.active) return;
      if (redial) clearTimeout(redial);
      redial = null;
      socket.connect();
    };

    // A laptop waking from sleep, or a tab left in the background, has missed events either way.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refresh();
      redialNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", redialNow);

    if (pollOnly || !SOCKET_URL) {
      startPolling();
    } else {
      socket = io(`${SOCKET_URL.replace(/\/$/, "")}/owner`, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelayMax: REDIAL_MAX_MS,
        auth: (cb) => {
          fetch("/api/realtime/ticket", { method: "POST" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => cb({ token: j?.ticket ?? "" }))
            .catch(() => cb({ token: "" }));
        },
      });
      socket.on("connect", () => {
        redialDelay = REDIAL_MIN_MS;
        // Anything that changed while disconnected (or polling) was not announced to us.
        if (poll) refresh();
        stopPolling();
      });
      socket.on("connect_error", () => {
        startPolling();
        scheduleRedial();
      });
      socket.on("disconnect", (reason) => {
        if (reason === "io client disconnect") return; // our own close() on unmount
        startPolling();
        scheduleRedial();
      });
      for (const event of eventKey.split(",")) socket.on(event, refresh);
    }

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", redialNow);
      if (debounce) clearTimeout(debounce);
      if (redial) clearTimeout(redial);
      stopPolling();
      socket?.close();
    };
  }, [eventKey, pollOnly, pollMs]);

  return null;
}
