"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { t, format } from "@/i18n";

import { QueueDetailSheet } from "@/components/QueueDetailSheet";
import { QueueTicketCard } from "@/components/QueueTicketCard";
import { showToast } from "@/lib/toast";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/Icon";
import { WalkInSheet } from "@/components/WalkInSheet";
import type { QueueCard, SeatGroup, ServiceRow, StaffRow } from "@/lib/server-api";

type DropTarget = { seatId: string; waitingIndex: number };

const DRAG_MIME = "application/x-tejotime-queue";

function waitingCards(seat: SeatGroup) {
  return seat.cards.filter((c) => c.status === "waiting");
}

function servingCards(seat: SeatGroup) {
  return seat.cards.filter((c) => c.status === "in_service");
}

/** Optimistic splice of a waiting card within or across seats. */
function placeCard(seats: SeatGroup[], cardId: string, toSeatId: string, toWaitingIndex: number): SeatGroup[] {
  let moving: QueueCard | null = null;
  const stripped = seats.map((seat) => {
    const hit = seat.cards.find((c) => c.id === cardId);
    if (!hit || hit.status !== "waiting") return seat;
    moving = { ...hit, seatId: toSeatId, seatName: seat.name };
    const cards = seat.cards.filter((c) => c.id !== cardId);
    const waiting = cards.filter((c) => c.status === "waiting").length;
    return {
      ...seat,
      cards,
      waitingCount: waiting,
      empty: cards.length === 0,
      free: !cards.some((c) => c.status === "in_service"),
    };
  });
  if (!moving) return seats;

  return stripped.map((seat) => {
    if (seat.id !== toSeatId) return seat;
    const serving = servingCards(seat);
    const waiting = waitingCards(seat);
    const idx = Math.max(0, Math.min(toWaitingIndex, waiting.length));
    const nextWaiting = [...waiting];
    nextWaiting.splice(idx, 0, {
      ...moving!,
      seatId: seat.id,
      seatName: seat.name,
    });
    const cards = [...serving, ...nextWaiting];
    return {
      ...seat,
      cards,
      waitingCount: nextWaiting.length,
      empty: cards.length === 0,
      free: serving.length === 0,
      serving: serving.length > 0,
    };
  });
}

function findCard(seats: SeatGroup[], cardId: string): { card: QueueCard; seatId: string } | null {
  for (const seat of seats) {
    const card = seat.cards.find((c) => c.id === cardId);
    if (card) return { card, seatId: seat.id };
  }
  return null;
}

/**
 * Interactive queue board with Kanban drag: reorder waiting tickets within a seat, or drop
 * onto another seat. Uses HTML5 DnD from a grip so Start / End stay clickable.
 */
export function QueueBoard({
  initialSeats,
  staff,
  services,
  walkInOpen,
  walkInSeatId = null,
  onWalkInOpenChange,
  onAddWalkInTo,
  singleChair = false,
  category,
}: {
  initialSeats: SeatGroup[];
  staff: StaffRow[];
  services: ServiceRow[];
  walkInOpen: boolean;
  /** Seat the walk-in sheet opens on (an empty seat's shortcut); null = Any. */
  walkInSeatId?: string | null;
  onWalkInOpenChange: (open: boolean) => void;
  /** An empty seat's "add a walk-in here". */
  onAddWalkInTo: (seatId: string) => void;
  singleChair?: boolean;
  /** Business category — gates checkout add-on chips in the detail sheet. */
  category?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState("all");
  const [seatsState, setSeatsState] = useState(initialSeats);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const dragSourceSeat = useRef<string | null>(null);
  const committing = useRef(false);

  /**
   * Re-sync the optimistic seat list when the server sends a new one.
   *
   * Adjusted DURING RENDER rather than in an effect. React documents this exact pattern for
   * "a prop changed, reset some state": it re-runs the component immediately without
   * committing the stale render, so the board never paints one frame of old seats. An effect
   * would paint first and correct afterwards, which is both a visible flicker and what
   * react-hooks/set-state-in-effect exists to catch.
   */
  const [syncedSeats, setSyncedSeats] = useState(initialSeats);
  if (syncedSeats !== initialSeats) {
    setSyncedSeats(initialSeats);
    setSeatsState(initialSeats);
  }
  // The ref is cleared in an effect, not above: a ref must not be touched during render, and
  // unlike the seat list it has nothing to do with what gets painted — it only needs to be
  // false again by the time the next drag starts.
  useEffect(() => {
    committing.current = false;
  }, [initialSeats]);

  const pending = running ?? (isPending ? held : null);
  const isRunning = (id: string, action: string) => pending === `${id}:${action}`;
  const cardBusy = (id: string) => !!pending && pending.startsWith(`${id}:`);

  /**
   * The open card, read from the LIVE board on every render — as the app's DetailPanel reads it
   * from the store. A snapshot taken at click time kept offering Start to a customer another
   * device had already started (the API then refused it), and kept the old service line after an
   * add-on. A card that has left the board (completed or no-showed elsewhere) closes the screen,
   * as on the app.
   */
  const openCard = openId ? (findCard(seatsState, openId)?.card ?? null) : null;

  const seats = filter === "all" ? seatsState : seatsState.filter((s) => s.id === filter);
  const totalWaiting = seatsState.reduce((n, s) => n + waitingCards(s).length, 0);
  /**
   * A card can only move to another seat that is on screen — the All view, as the app's
   * `canCrossSeat`. With one seat picked from the chips, the tip used to promise a move even on an
   * empty seat with nothing to drag.
   */
  const canCrossSeat = !singleChair && filter === "all" && seatsState.length > 1;
  /** Only worth saying once there is something to drag: two in a seat, or seats to move to. */
  const showDragTip = seats.some((s) => waitingCards(s).length > 1) || (canCrossSeat && totalWaiting > 0);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function act(entryId: string, action: "start" | "no-show", name: string) {
    const key = `${entryId}:${action}`;
    setRunning(key);
    setHeld(key);
    try {
      const res = await fetch(`/api/queue/${entryId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json?.error?.message ?? t.queue.actionFailed, "error");
        return;
      }
      showToast(
        action === "start" ? format(t.queue.startedToast, { name }) : format(t.queue.noShowToast, { name }),
        "success",
      );
      refresh();
    } catch {
      showToast(t.queue.networkError, "error");
    } finally {
      setRunning(null);
    }
  }

  async function commitDrop(cardId: string, fromSeatId: string, toSeatId: string, toWaitingIndex: number) {
    committing.current = true;
    setSeatsState((prev) => placeCard(prev, cardId, toSeatId, toWaitingIndex));
    try {
      if (fromSeatId !== toSeatId) {
        const re = await fetch(`/api/queue/${cardId}/reassign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ staffId: toSeatId }),
        });
        if (!re.ok) {
          const json = await re.json().catch(() => ({}));
          throw new Error(json?.error?.message ?? t.queue.errReassign);
        }
      }
      const mv = await fetch(`/api/queue/${cardId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toIndex: toWaitingIndex }),
      });
      if (!mv.ok) {
        const json = await mv.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? t.queue.errReorder);
      }
      showToast(
        fromSeatId === toSeatId ? t.queue.okReorder : t.queue.okMoved,
        "success",
      );
      refresh();
    } catch (e) {
      committing.current = false;
      showToast(e instanceof Error ? e.message : t.queue.actionFailed, "error");
      refresh();
    }
  }

  function onDragStart(e: React.DragEvent, card: QueueCard, seatId: string) {
    if (card.status !== "waiting") {
      e.preventDefault();
      return;
    }
    dragSourceSeat.current = seatId;
    setDragId(card.id);
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ cardId: card.id, fromSeatId: seatId }));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragEnd() {
    setDragId(null);
    setDropTarget(null);
    dragSourceSeat.current = null;
  }

  function onDragOverSeat(e: React.DragEvent, seatId: string, waitingIndex: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ seatId, waitingIndex });
  }

  function onDropSeat(e: React.DragEvent, seatId: string, waitingIndex: number) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    onDragEnd();
    if (!raw) return;
    try {
      const { cardId, fromSeatId } = JSON.parse(raw) as { cardId: string; fromSeatId: string };
      const found = findCard(seatsState, cardId);
      if (!found || found.card.status !== "waiting") return;
      // No-op drop back onto the same slot.
      const fromWaiting = waitingCards(seatsState.find((s) => s.id === fromSeatId)!);
      const fromIdx = fromWaiting.findIndex((c) => c.id === cardId);
      if (fromSeatId === seatId && (fromIdx === waitingIndex || fromIdx === waitingIndex - 1)) {
        return;
      }
      // When dropping after self in the same list, account for removal shifting indices.
      let toIdx = waitingIndex;
      if (fromSeatId === seatId && fromIdx >= 0 && fromIdx < waitingIndex) {
        toIdx = waitingIndex - 1;
      }
      void commitDrop(cardId, fromSeatId, seatId, Math.max(0, toIdx));
    } catch {
      /* ignore malformed payload */
    }
  }

  return (
    <>
      <div className="home-section-row seats-head">
        <h2 className="home-section-title">{singleChair ? t.dashboard.yourQueue : t.dashboard.seatsTitle}</h2>
        {showDragTip ? <span className="seats-tip">{t.dashboard.dragTip}</span> : null}
      </div>

      {/* Filter chips only when there is something to filter: two or more seats. The old
          single-seat "N waiting" pill repeated the live card, and the Walk-in chip repeated the
          card's main action. */}
      {!singleChair ? (
        <div className="chip-row">
          <button
            type="button"
            className={`filter-chip ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            {t.queue.all} <span className="filter-chip-count">{totalWaiting}</span>
          </button>
          {seatsState.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`filter-chip ${filter === s.id ? "active" : ""}`}
              onClick={() => setFilter(s.id)}
            >
              <span className="filter-chip-label">{s.name}</span>
              <span className="filter-chip-count">{waitingCards(s).length}</span>
            </button>
          ))}
        </div>
      ) : null}

      {dragId ? (
        <p className="queue-drag-hint">{canCrossSeat ? t.queue.dragHint : t.queue.dragHintSingle}</p>
      ) : null}

      {seats.length === 0 ? (
        <p className="home-empty">{t.queue.noSeats}</p>
      ) : (
        <div className={`seat-list${singleChair || seats.length === 1 ? " seat-list-single" : ""}${dragId ? " is-dragging" : ""}`}>
          {seats.map((seat) => {
            const waiting = waitingCards(seat);
            const serving = servingCards(seat);
            return (
              <section
                key={seat.id}
                className={`seat-card seat-card-board ${
                  dropTarget?.seatId === seat.id ? "seat-drop-active" : ""
                }`}
                onDragOver={(e) => onDragOverSeat(e, seat.id, waiting.length)}
                onDrop={(e) => onDropSeat(e, seat.id, waiting.length)}
              >
                <header className="seat-header">
                  <span className={`seat-avatar seat-avatar-${seat.colorToken || "primary"}`} aria-hidden>
                    {seat.name[0]}
                  </span>
                  <span className="seat-body">
                    <span className="nm">{seat.name}</span>
                    {/* Green while the chair is free, brand colour while serving: readable down a
                        column of seats before the words are. The line wraps rather than
                        truncating, so "~30m" is never cut off. */}
                    <span className="meta seat-subline">
                      <span className={`seat-dot ${seat.serving ? "serving" : "free"}`} aria-hidden />
                      {seat.subLine}
                    </span>
                  </span>
                  <span className={`seat-status ${seat.free ? "free" : "waiting"}`}>{seat.waitBadge}</span>
                </header>

                <ul className="home-queue-list seat-queue-list">
                  {/* Cards are the app's QueueCard (see QueueTicketCard): number tile, name,
                      "Walk-in · Haircut", status dot + ETA. */}
                  {serving.map((card) => (
                    <li key={card.id} className="qc-item">
                      <QueueTicketCard
                        card={card}
                        busy={cardBusy(card.id)}
                        noShowRunning={isRunning(card.id, "no-show")}
                        onOpen={() => setOpenId(card.id)}
                        onNoShow={() => act(card.id, "no-show", card.name)}
                      />
                    </li>
                  ))}

                  {waiting.map((card, waitIdx) => (
                    <li key={card.id}>
                      <div
                        className={`queue-drop-slot ${
                          dropTarget?.seatId === seat.id && dropTarget.waitingIndex === waitIdx
                            ? "active"
                            : ""
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDragOverSeat(e, seat.id, waitIdx);
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          onDropSeat(e, seat.id, waitIdx);
                        }}
                      />
                      <QueueTicketCard
                        card={card}
                        dragging={dragId === card.id}
                        busy={cardBusy(card.id)}
                        startRunning={isRunning(card.id, "start")}
                        noShowRunning={isRunning(card.id, "no-show")}
                        onOpen={() => setOpenId(card.id)}
                        // No quick Start while the chair is busy: queue_start refuses it with
                        // SEAT_BUSY every time. The Customer screen explains why and offers the move.
                        onStart={serving.length > 0 ? undefined : () => act(card.id, "start", card.name)}
                        onNoShow={() => act(card.id, "no-show", card.name)}
                        onDragStart={(e) => onDragStart(e, card, seat.id)}
                        onDragEnd={onDragEnd}
                      />
                    </li>
                  ))}

                  <div
                    className={`queue-drop-slot queue-drop-slot-end ${
                      dropTarget?.seatId === seat.id && dropTarget.waitingIndex === waiting.length
                        ? "active"
                        : ""
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDragOverSeat(e, seat.id, waiting.length);
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      onDropSeat(e, seat.id, waiting.length);
                    }}
                  />

                  {seat.cards.length === 0 ? (
                    dragId ? (
                      <p className="seat-empty seat-empty-drop">{t.queue.dropHere}</p>
                    ) : (
                      // An empty seat is a shortcut: the walk-in sheet with this seat chosen.
                      <button type="button" className="seat-free-cta" onClick={() => onAddWalkInTo(seat.id)}>
                        <span className="seat-free-icon" aria-hidden>
                          <Icon name="plus" size={16} />
                        </span>
                        <span className="seat-free-text">
                          <span className="nm">{t.dashboard.seatFreeTitle}</span>
                          <span className="meta">{t.dashboard.seatFreeHint}</span>
                        </span>
                      </button>
                    )
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {openCard ? (
        <QueueDetailSheet
          // One instance per customer, so a typed amount can never carry over to the next card.
          key={openCard.id}
          card={openCard}
          seats={seatsState}
          category={category}
          onClose={() => setOpenId(null)}
          onChanged={() => refresh()}
        />
      ) : null}

      {/* Mounted only while open — see WalkInSheet for why. */}
      {walkInOpen ? (
      <WalkInSheet
        onClose={() => onWalkInOpenChange(false)}
        initialSeatId={walkInSeatId}
        staff={staff}
        services={services}
        seats={seatsState}
        category={category}
        onAdded={() => {
          // The sheet has already toasted "Added as next" / "Added to queue" (see WalkInSheet).
          onWalkInOpenChange(false);
          refresh();
        }}
      />
      ) : null}
    </>
  );
}
