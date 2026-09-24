"use client";

import type { DragEvent } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import type { QueueCard } from "@/lib/server-api";
import "@/styles/shell-sheets.css";

/**
 * One ticket on a seat board — the web twin of the app's `QueueCard`: the place-in-line number
 * tile, the name (with the MR / Patient badge for a hospital), "Walk-in · Haircut" underneath, and
 * the status dot with the ETA on the right. In the chair, the card is tinted in the brand colour
 * and the tile fills with it.
 *
 * Clicking anywhere on it opens the Customer screen (QueueDetailSheet), which holds every action —
 * as tapping does on the app. Two web-only affordances are kept, restyled rather than dropped:
 *
 *  - **Drag.** The number tile is the drag handle (HTML5 drag; the board handles the drop). With
 *    a mouse over the card it turns into a grip, so the handle announces itself without costing a
 *    column the app does not have. A plain click on it still opens the card.
 *  - **Quick actions.** Start / End and no-show appear over the right edge while a MOUSE is over
 *    the card (or focus is inside it). Touch screens never see them — there they would crowd a
 *    340px seat board, and the Customer screen one tap away has the same buttons, as on the app.
 */
export function QueueTicketCard({
  card,
  busy,
  dragging = false,
  startRunning = false,
  noShowRunning = false,
  onOpen,
  onStart,
  onNoShow,
  onDragStart,
  onDragEnd,
}: {
  card: QueueCard;
  /** Any action on this card in flight: every button is disabled. */
  busy: boolean;
  dragging?: boolean;
  startRunning?: boolean;
  noShowRunning?: boolean;
  onOpen: () => void;
  /**
   * Waiting cards only. In the chair, the primary action is End, which opens the checkout. The
   * board leaves it out while the chair is busy (the API would refuse it), and then only the
   * no-show × shows.
   */
  onStart?: () => void;
  onNoShow: () => void;
  /** Present for waiting cards, which are the only ones that can be dragged. */
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const inService = card.status === "in_service";
  const source = card.online ? t.queue.online : t.queue.walkIn;
  const draggable = !inService && !!onDragStart;

  return (
    <div className={`qc${inService ? " qc-active" : ""}${dragging ? " qc-dragging" : ""}`}>
      {/* Whole-card hit target. Above the text so a click on the name opens the card; the handle
          and the quick actions sit above it again so they keep their own clicks. */}
      <button
        type="button"
        className="qc-open"
        onClick={onOpen}
        aria-label={format(t.queue.openCard, { name: card.name })}
      />

      {draggable ? (
        <button
          type="button"
          className="qc-num qc-handle"
          draggable
          // Not a tab stop: HTML5 drag has no keyboard path, and the open button above already
          // gives the keyboard this card.
          tabIndex={-1}
          title={format(t.queue.dragCard, { name: card.name })}
          aria-label={format(t.queue.dragCard, { name: card.name })}
          onClick={onOpen}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <span className="qc-num-text">{card.position}</span>
          {/* The class sits on a wrapper, not on the Icon: Icon's inline `display: block` beat the
              stylesheet's `.qc-num-grip { display: none }`, so every waiting tile showed "2 ⋮⋮" —
              the number and the grip side by side, on touch screens too — instead of the number,
              turning into the grip only under the mouse. */}
          <span className="qc-num-grip">
            <Icon name="gripVertical" size={16} />
          </span>
        </button>
      ) : (
        <span className="qc-num" aria-hidden>
          {card.position}
        </span>
      )}

      <div className="qc-body">
        <div className="qc-name-row">
          <span className="qc-name">{card.name}</span>
          {card.visitorType ? (
            <span className={`qc-badge ${card.visitorType === "mr" ? "info" : "secondary"}`}>
              {card.visitorType === "mr" ? t.queue.mr : t.queue.patient}
            </span>
          ) : null}
        </div>
        <div className="qc-sub">{[source, card.service].filter(Boolean).join(" · ")}</div>
      </div>

      <div className="qc-right">
        <span className="qc-dot" aria-hidden />
        <span className="qc-eta">{card.rightText}</span>
      </div>

      <div className="qc-actions">
        {inService ? (
          // End opens the checkout rather than closing the visit blind: the amount has to be
          // confirmed first (see QueueDetailSheet).
          <button type="button" className="qc-btn danger" disabled={busy} onClick={onOpen}>
            {t.queue.end}
          </button>
        ) : onStart ? (
          <button type="button" className="qc-btn success" disabled={busy} onClick={onStart}>
            {startRunning ? <Spinner size={13} /> : null}
            {t.queue.start}
          </button>
        ) : null}
        <button
          type="button"
          className="qc-btn qc-btn-x"
          disabled={busy}
          onClick={onNoShow}
          title={t.queue.markNoShow}
          aria-label={format(t.queue.markNoShowAria, { name: card.name })}
        >
          {noShowRunning ? <Spinner size={13} /> : <Icon name="x" size={15} />}
        </button>
      </div>
    </div>
  );
}
