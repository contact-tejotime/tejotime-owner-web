"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { t, format } from "@/i18n";

import { QueueDetailSheet } from "@/components/QueueDetailSheet";
import { Spinner } from "@/components/Skeleton";
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
  onWalkInOpenChange,
  singleChair = false,
  category,
}: {
  initialSeats: SeatGroup[];
  staff: StaffRow[];
  services: ServiceRow[];
  walkInOpen: boolean;
  onWalkInOpenChange: (open: boolean) => void;
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
  const [openCard, setOpenCard] = useState<QueueCard | null>(null);
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

  const seats = filter === "all" ? seatsState : seatsState.filter((s) => s.id === filter);
  const totalWaiting = seatsState.reduce((n, s) => n + waitingCards(s).length, 0);

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
      showToast(e instanceof Error ? e.message : "That didn't work. Try again.", "error");
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
      <div className={`chip-row${singleChair ? " chip-row-staff" : ""}`}>
        {singleChair ? (
          <span className="queue-waiting-pill">{totalWaiting} waiting</span>
        ) : (
          <>
            <button
              type="button"
              className={`filter-chip ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All <span className="filter-chip-count">{totalWaiting}</span>
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
          </>
        )}
        <button type="button" className="filter-chip filter-chip-cta" onClick={() => onWalkInOpenChange(true)}>
          <Icon name="plus" size={15} color="#fff" />
          {t.queue.walkIn}
        </button>
      </div>

      {dragId ? (
        <p className="queue-drag-hint">
          {singleChair
            ? t.queue.dragHintSingle
            : t.queue.dragHint}
        </p>
      ) : null}

      {seats.length === 0 ? (
        <p className="home-empty">{t.queue.noSeats}</p>
      ) : (
        <div className={`seat-list${singleChair ? " seat-list-single" : ""}${dragId ? " is-dragging" : ""}`}>
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
                    <span className="meta">{seat.subLine}</span>
                  </span>
                  <span className={`seat-status ${seat.serving ? "busy" : "free"}`}>
                    {seat.serving ? t.queue.busy : t.queue.free}
                  </span>
                </header>

                <ul className="home-queue-list seat-queue-list">
                  {serving.map((card) => (
                    <li key={card.id} className="home-queue-card serving">
                      <button
                        type="button"
                        className="card-open"
                        onClick={() => setOpenCard(card)}
                        aria-label={format(t.queue.openCard, { name: card.name })}
                      />
                      <div className="card-main">
                        <div className="title">{card.name}</div>
                        <div className="meta">
                          {[card.service, card.rightText].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="card-actions">
                        <button
                          type="button"
                          className="btn danger btn-sm card-action-btn"
                          disabled={cardBusy(card.id)}
                          onClick={() => setOpenCard(card)}
                        >
                          {t.queue.end}
                        </button>
                        <button
                          type="button"
                          className="btn secondary btn-sm btn-icon card-action-x"
                          disabled={cardBusy(card.id)}
                          onClick={() => act(card.id, "no-show", card.name)}
                          title={t.queue.markNoShow}
                          aria-label={format(t.queue.markNoShowAria, { name: card.name })}
                        >
                          {isRunning(card.id, "no-show") ? <Spinner size={13} /> : <Icon name="x" size={15} />}
                        </button>
                      </div>
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
                      <div
                        className={`home-queue-card ${dragId === card.id ? "is-dragging-card" : ""}`}
                        draggable={false}
                      >
                        <button
                          type="button"
                          className="card-drag-grip"
                          draggable
                          aria-label={format(t.queue.dragCard, { name: card.name })}
                          onDragStart={(e) => onDragStart(e, card, seat.id)}
                          onDragEnd={onDragEnd}
                        >
                          <Icon name="gripVertical" size={16} />
                        </button>
                        <button
                          type="button"
                          className="card-open"
                          onClick={() => setOpenCard(card)}
                          aria-label={format(t.queue.openCard, { name: card.name })}
                        />
                        <div className="card-main">
                          <div className="title">{card.name}</div>
                          <div className="meta">
                            {[card.service, card.rightText].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div className="card-actions">
                          <button
                            type="button"
                            className="btn success btn-sm card-action-btn"
                            disabled={cardBusy(card.id)}
                            onClick={() => act(card.id, "start", card.name)}
                          >
                            {isRunning(card.id, "start") ? <Spinner size={13} /> : null}
                            {t.queue.start}
                          </button>
                          <button
                            type="button"
                            className="btn secondary btn-sm btn-icon card-action-x"
                            disabled={cardBusy(card.id)}
                            onClick={() => act(card.id, "no-show", card.name)}
                            title={t.queue.markNoShow}
                            aria-label={format(t.queue.markNoShowAria, { name: card.name })}
                          >
                            {isRunning(card.id, "no-show") ? <Spinner size={13} /> : <Icon name="x" size={15} />}
                          </button>
                        </div>
                      </div>
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
                    <p className="seat-empty seat-empty-drop">{t.queue.dropHere}</p>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {openCard ? (
        <QueueDetailSheet
          card={openCard}
          seats={seatsState}
          category={category}
          onClose={() => setOpenCard(null)}
          onChanged={() => refresh()}
        />
      ) : null}

      {/* Mounted only while open — see WalkInSheet for why. */}
      {walkInOpen ? (
      <WalkInSheet
        onClose={() => onWalkInOpenChange(false)}
        staff={staff}
        services={services}
        onAdded={() => {
          onWalkInOpenChange(false);
          refresh();
        }}
      />
      ) : null}
    </>
  );
}
