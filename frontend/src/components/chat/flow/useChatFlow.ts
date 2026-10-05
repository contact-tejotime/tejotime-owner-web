"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { t, format } from "@/i18n";
import type { ChatFlowBinding } from "./binding";
import {
  initialState,
  starterOptions,
  step,
  type ApptView,
  type Draft,
  type Effect,
  type FlowCtx,
  type FlowError,
  type FlowState,
  type Input,
  type Out,
  type SlotLite,
} from "./engine";

const S = t.chat.flow;

/** The page-side operations a flow effect may call — the SAME code paths the Join / Book pop-up uses. */
export interface FlowAdapter {
  fetchSlots: (date: string, serviceIds: string[], staffId: string) => Promise<SlotLite[]>;
  /** Re-reads live staff (and updates the page); resolves the active staff ids. */
  refreshStaffIds: () => Promise<string[]>;
  join: (d: Draft) => Promise<{ alreadyInQueue: boolean }>;
  book: (d: Draft) => Promise<ApptView>;
  track: (phone: string) => Promise<{ found: boolean; status?: string; token?: string; isYourTurn?: boolean }>;
  leave: () => Promise<void>;
  lookupAppts: (phone: string) => Promise<ApptView[]>;
  cancelAppt: (id: string) => Promise<void>;
}

/** Thrown by the adapter when the page's local "too many attempts" guard stops a join/book. */
export class BlockedError extends Error {}

/** Live ticket signals from the page's socket + poll, turned into chat messages. */
export interface TicketSignals {
  status: string | null;
  justTurn: boolean;
  /** Set by `ticket:eta_15`; `at` makes a repeat event distinguishable. */
  eta: { min: number; at: number } | null;
}

// How often the time step re-reads slots. Booking emits no socket event, so this timer (plus a
// re-check on tab focus and a pre-flight before Confirm) is what keeps the list honest. Well under
// the publicRead 60/min budget even with the page's own polling alongside.
const SLOT_REFRESH_MS = 30_000;
const MIN_REFRESH_GAP_MS = 10_000;

function toFlowError(e: unknown, rateLimitIsBlock: boolean): FlowError {
  if (e instanceof BlockedError) return { status: 429, code: "BLOCKED", message: S.blocked, blocked: true };
  if (e instanceof ApiError) {
    return {
      status: e.status,
      code: e.code,
      message: e.message,
      blocked: rateLimitIsBlock && e.code === "RATE_LIMITED",
    };
  }
  return { status: 0, code: "NETWORK", message: t.chat.errUnavailable };
}

const isActiveStatus = (s: string | null) => s === "waiting" || s === "in_service";

export function useChatFlow({
  getCtx,
  adapter,
  signals,
}: {
  /**
   * Evaluated at each step, so the flow always sees the page as it is NOW (live staff, held
   * ticket…). `now` is stamped here, at the step, rather than by the page during render.
   */
  getCtx: () => Omit<FlowCtx, "now">;
  adapter: FlowAdapter;
  signals: TicketSignals;
}): { state: FlowState; binding: Omit<ChatFlowBinding, "renderCard"> } {
  const [state, setState] = useState<FlowState>(initialState);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef<FlowState>(state);
  const getCtxRef = useRef(getCtx);
  const adapterRef = useRef(adapter);
  const pushRef = useRef<((msgs: Out[]) => void) | null>(null);
  const busyRef = useRef(false);
  const lastRefresh = useRef(0);
  // Live ticket messages are only posted once the chat has shown this customer a ticket card —
  // a visitor who never touched the chat should not find it full of queue chatter.
  const watchingTicket = useRef(false);
  const selfLeaveAt = useRef(0);

  useEffect(() => {
    getCtxRef.current = getCtx;
    adapterRef.current = adapter;
  });

  const push = useCallback((msgs: Out[]) => {
    if (msgs.some((m) => m.card?.type === "ticket")) watchingTicket.current = true;
    pushRef.current?.(msgs);
  }, []);

  const execute = useCallback(async (effect: Effect): Promise<Input> => {
    const a = adapterRef.current;
    const ok = (data: unknown): Input => ({ kind: "result", effect, ok: true, data });
    try {
      switch (effect.type) {
        case "fetchSlots":
          return ok({ slots: await a.fetchSlots(effect.date, effect.serviceIds, effect.staffId) });
        case "preflightJoin": {
          // A failed re-read must not block a check-in the server would accept: fall back to the
          // staff the page already shows.
          const staffIds = await a.refreshStaffIds().catch(() => getCtxRef.current().staff.map((s) => s.id));
          return ok({ staffIds });
        }
        case "preflightBook": {
          const d = effect.draft;
          const [staffIds, slots] = await Promise.all([
            a.refreshStaffIds().catch(() => getCtxRef.current().staff.map((s) => s.id)),
            a.fetchSlots(d.date ?? "", d.serviceIds, d.staffId ?? "any").catch(() => (d.slot ? [d.slot] : [])),
          ]);
          return ok({ staffIds, slots });
        }
        case "join":
          return ok(await a.join(effect.draft));
        case "book":
          return ok({ appt: await a.book(effect.draft) });
        case "track":
          return ok(await a.track(effect.phone));
        case "leave":
          selfLeaveAt.current = Date.now();
          await a.leave();
          return ok({});
        case "lookupAppts":
          return ok({ appts: await a.lookupAppts(effect.phone) });
        case "cancelAppt":
          await a.cancelAppt(effect.id);
          return ok({});
        case "askServer":
          return ok({});
      }
    } catch (e) {
      // Only a check-in 429 is the page's "too many attempts" block. Booking is never blocked by
      // it (the block guards the walk-in line), and a lookup 429 is just a busy network.
      const rateLimitIsBlock = effect.type === "join";
      return { kind: "result", effect, ok: false, error: toFlowError(e, rateLimitIsBlock) };
    }
  }, []);

  /** Feeds one input through the machine, then runs effects until it settles. */
  const run = useCallback(
    async (input: Input): Promise<boolean> => {
      let next: Input | null = input;
      let consumed = true;
      for (let guard = 0; next && guard < 8; guard += 1) {
        const r = step(stateRef.current, next, { ...getCtxRef.current(), now: Date.now() });
        stateRef.current = r.state;
        setState(r.state);
        if (r.out.length) push(r.out);
        next = null;
        if (!r.effect) break;
        if (r.effect.type === "askServer") {
          consumed = false;
          break;
        }
        const silent = r.effect.type === "fetchSlots" && r.effect.silent;
        if (!silent) {
          busyRef.current = true;
          setBusy(true);
        }
        try {
          next = await execute(r.effect);
        } finally {
          if (!silent) {
            busyRef.current = false;
            setBusy(false);
          }
        }
      }
      return consumed;
    },
    [execute, push],
  );

  // ---- live slots on the time step ----
  const onTimeStep = state.step === "time";
  useEffect(() => {
    if (!onTimeStep) return;
    const refresh = () => {
      if (busyRef.current || Date.now() - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
      lastRefresh.current = Date.now();
      void run({ kind: "refresh" });
    };
    const id = setInterval(refresh, SLOT_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onTimeStep, run]);

  // ---- live ticket events → chat messages ----
  const prevSignals = useRef<TicketSignals>(signals);
  useEffect(() => {
    const prev = prevSignals.current;
    prevSignals.current = signals;
    if (!watchingTicket.current) return;
    if (signals.justTurn && !prev.justTurn && isActiveStatus(signals.status)) {
      push([{ text: S.turnNow, card: { type: "ticket" } }]);
      return;
    }
    if (isActiveStatus(prev.status) && signals.status === "completed") {
      push([{ text: S.visitDone, options: starterOptions() }]);
      return;
    }
    // Our own Leave also flips the ticket to cancelled (the server echoes ticket:cancelled to the
    // room); that one already has its own reply, so only a store-side cancel is announced.
    if (isActiveStatus(prev.status) && signals.status === "cancelled" && Date.now() - selfLeaveAt.current > 15_000) {
      push([{ text: S.ticketCancelled, options: [{ id: "start:join", label: S.checkInNow }, { id: "done", label: S.done }] }]);
      return;
    }
    if (signals.eta && signals.eta.at !== prev.eta?.at && isActiveStatus(signals.status)) {
      push([{ text: format(S.eta15, { min: signals.eta.min }) }]);
    }
  }, [signals, push]);

  const attach = useCallback((fn: (msgs: Out[]) => void) => {
    pushRef.current = fn;
    return () => {
      if (pushRef.current === fn) pushRef.current = null;
    };
  }, []);

  const onText = useCallback((text: string) => run({ kind: "text", text }), [run]);
  const onOption = useCallback(
    (id: string, value?: unknown) => {
      if (busyRef.current) return;
      void run({ kind: "option", id, value });
    },
    [run],
  );
  const onAction = useCallback(
    (type: string) => {
      if (type !== "join" && type !== "book" && type !== "track") return false;
      void run({ kind: "start", flow: type });
      return true;
    },
    [run],
  );
  const afterServerReply = useCallback(() => {
    void run({ kind: "aside" });
  }, [run]);

  const phoneStep = state.step === "phone" || state.step === "trackPhone" || state.step === "apptsPhone";
  const inFlow = !!state.kind && state.step !== "result";

  return {
    state,
    binding: {
      starters: starterOptions(),
      attach,
      onText,
      onOption,
      onAction,
      afterServerReply,
      inputMode: phoneStep ? "tel" : "text",
      placeholder:
        state.step === "name"
          ? S.placeholderName
          : phoneStep
            ? S.placeholderPhone
            : inFlow
              ? S.placeholderAnswer
              : t.chat.placeholder,
      busy,
    },
  };
}
